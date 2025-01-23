let ws;
let localStream;
let peerConnections = new Map();
let username;
let isStreaming = false;
let mediaRecorder = null;

const configuration = {
    iceServers: [{
        urls: 'stun:stun.l.google.com:19302'
    }]
};

function connect() {
    if (ws?.readyState === WebSocket.CONNECTING) return;
    
    ws = new WebSocket('ws://localhost:8080');
    
    ws.onmessage = async (event) => {
        const data = JSON.parse(event.data);
        handleWebSocketMessage(data);
    };

    ws.onclose = () => {
        stopStreaming();
        setTimeout(connect, 1000);
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        ws.close();
    };
}

async function handleWebSocketMessage(data) {
    switch(data.type) {
        case 'users':
            updateUserList(data.users);
            break;
        case 'offer':
            await handleOffer(data);
            break;
        case 'answer':
            await handleAnswer(data);
            break;
        case 'ice-candidate':
            await handleIceCandidate(data);
            break;
        case 'user-disconnected':
            removeConnection(data.username);
            break;
    }
}

async function register() {
    username = document.getElementById('username').value;
    if (!username) return;
    
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true
        });
        document.getElementById('localVideo').srcObject = localStream;
        
        connect();
        ws.onopen = () => {
            ws.send(JSON.stringify({
                type: 'register',
                username: username,
                isStreamer: true
            }));
        };
        
        document.getElementById('username').disabled = true;
        document.getElementById('startStreamBtn').disabled = false;
        initializeStreamingControls();
    } catch(err) {
        console.error('Error:', err);
    }
}

function initializeStreamingControls() {
    document.getElementById('startStreamBtn').onclick = startStreaming;
    document.getElementById('stopStreamBtn').onclick = stopStreaming;
}

function startStreaming() {
    if (!localStream || isStreaming) return;
    
    try {
        const options = { 
            mimeType: 'video/webm;codecs=h264,opus',
            videoBitsPerSecond: 1000000,
            audioBitsPerSecond: 64000
        };
        
        mediaRecorder = new MediaRecorder(localStream, options);
        mediaRecorder.ondataavailable = async (event) => {
            if (event.data.size > 0 && ws.readyState === WebSocket.OPEN) {
                const arrayBuffer = await event.data.arrayBuffer();
                const chunk = Array.from(new Uint8Array(arrayBuffer));
                const maxSize = 8192;
                
                for(let i = 0; i < chunk.length; i += maxSize) {
                    await new Promise(resolve => setTimeout(resolve, 10));
                    ws.send(JSON.stringify({
                        type: 'stream-data',
                        username: username,
                        chunk: chunk.slice(i, i + maxSize)
                    }));
                }
            }
        };

        mediaRecorder.start(500);
        isStreaming = true;
    } catch (error) {
        console.error('Streaming error:', error);
        isStreaming = false;
    }
}

function stopStreaming() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    }
    isStreaming = false;
    
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'stop-stream',
            username: username
        }));
    }
    
    document.getElementById('startStreamBtn').disabled = false;
    document.getElementById('stopStreamBtn').disabled = true;
}

function createPeerConnection(targetUser) {
    const pc = new RTCPeerConnection(configuration);

    pc.onconnectionstatechange = () => {
        console.log("Connection State:", pc.connectionState);
    };
    
    pc.onsignalingstatechange = () => {
        console.log("Signaling State:", pc.signalingState);
    };
    
    pc.oniceconnectionstatechange = () => {
        console.log("ICE Connection State:", pc.iceConnectionState);
    };
    
    if (localStream) {
        localStream.getTracks().forEach(track => {
            pc.addTrack(track, localStream);
        });
    }
    
    pc.onicecandidate = (event) => {
        if (event.candidate && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'ice-candidate',
                candidate: event.candidate,
                target: targetUser,
                from: username
            }));
        }
    };

    pc.ontrack = (event) => {
        const video = document.getElementById(`video-${targetUser}`) || 
                     createVideoElement(targetUser);
        video.srcObject = event.streams[0];
    };

    peerConnections.set(targetUser, pc);
    return pc;
}

async function handleOffer(data) {
    const pc = createPeerConnection(data.from);
    
    try {
        await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'answer',
                answer: answer,
                target: data.from,
                from: username
            }));
        }
    } catch(err) {
        console.error('Error handling offer:', err);
    }
}

async function handleAnswer(data) {
    const pc = peerConnections.get(data.from);
    if (pc) {
        try {
            await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        } catch(err) {
            console.error('Error handling answer:', err);
        }
    }
}

async function handleIceCandidate(data) {
    const pc = peerConnections.get(data.from);
    if (pc) {
        try {
            await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch(err) {
            console.error('Error handling ICE candidate:', err);
        }
    }
}

async function call(targetUser) {
    const pc = createPeerConnection(targetUser);
    
    try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'offer',
                offer: offer,
                target: targetUser,
                from: username
            }));
        }
    } catch(err) {
        console.error('Error creating offer:', err);
    }
}

function updateUserList(users) {
    const ul = document.getElementById('users');
    ul.innerHTML = '';
    users.forEach(user => {
        if (user !== username) {
            const li = document.createElement('li');
            li.className = 'flex items-center justify-between p-2 hover:bg-gray-100 rounded';
            li.innerHTML = `
                <span>${user}</span>
                <button onclick="call('${user}')" 
                        class="px-2 py-1 bg-blue-500 text-white text-sm rounded">
                    Connect
                </button>
            `;
            ul.appendChild(li);
        }
    });
}

function createVideoElement(userId) {
    const container = document.getElementById('videosContainer');
    const videoContainer = document.createElement('div');
    videoContainer.className = 'bg-black rounded-lg overflow-hidden';
    videoContainer.id = `video-container-${userId}`;
    
    const video = document.createElement('video');
    video.id = `video-${userId}`;
    video.autoplay = true;
    video.playsinline = true;
    video.className = 'w-full h-auto';
    
    videoContainer.appendChild(video);
    container.appendChild(videoContainer);
    return video;
}
