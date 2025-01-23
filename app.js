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

// WebSocket 연결
function connect() {
    if (ws?.readyState === WebSocket.CONNECTING) return; // 이미 연결 시도 중이면 중복 실행 방지
    
    ws = new WebSocket('ws://localhost:8080');
    
    ws.onmessage = async (event) => {
        const data = JSON.parse(event.data);
        handleWebSocketMessage(data);
    };

    ws.onclose = () => {
        console.log('WebSocket connection closed');
        stopStreaming();
        setTimeout(() => connect(), 3000); // 3초 후 재연결 시도
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
    };
}

// WebSocket 메시지 처리
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

// 사용자 등록
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

// 스트리밍 컨트롤 초기화
function initializeStreamingControls() {
    document.getElementById('startStreamBtn').onclick = startStreaming;
    document.getElementById('stopStreamBtn').onclick = stopStreaming;
}

// 스트리밍 시작
function startStreaming() {
    if (!localStream || isStreaming) return;

    // FFmpeg를 통한 RTMP 스트리밍 시작 (웹소켓 메시지 전송)
    // ws.send(JSON.stringify({
    //     type: 'start-stream',
    //     username: username,
    //     streamKey: username
    // }));

    // isStreaming = true;
    
    // document.getElementById('startStreamBtn').disabled = true;
    // document.getElementById('stopStreamBtn').disabled = false;
    
    // RTMP 스트림 시작
    ws.send(JSON.stringify({
        type: 'start-stream',
        username: username,
        streamKey: username
    }));

    // MediaRecorder 설정
    const options = { mimeType: 'video/webm' };
    mediaRecorder = new MediaRecorder(localStream, options);
    
    mediaRecorder.ondataavailable = async (event) => {
        if (event.data.size > 0) {
            const arrayBuffer = await event.data.arrayBuffer();
            console.log(`Sending stream chunk of size ${event.data.size} bytes`);
            ws.send(JSON.stringify({
                type: 'stream-data',
                username: username,
                chunk: Array.from(new Uint8Array(arrayBuffer))
            }));
        }
    };

    mediaRecorder.start(1000); // 1초마다 데이터 전송
    isStreaming = true;
    
    document.getElementById('startStreamBtn').disabled = true;
    document.getElementById('stopStreamBtn').disabled = false;
}

// 스트리밍 종료
function stopStreaming() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    }
    isStreaming = false;
    
    ws.send(JSON.stringify({
        type: 'stop-stream',
        username: username
    }));
    
    document.getElementById('startStreamBtn').disabled = false;
    document.getElementById('stopStreamBtn').disabled = true;
}

// P2P 연결 관리 함수들
function createPeerConnection(targetUser) {
    const pc = new RTCPeerConnection(configuration);
    
    localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
    });
    
    pc.onicecandidate = (event) => {
        if (event.candidate) {
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

    return pc;
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

// WebRTC 시그널링 처리 함수들 (이전과 동일)
async function handleOffer(data) {
    const pc = createPeerConnection(data.from);
    peerConnections.set(data.from, pc);
    
    try {
        await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        
        ws.send(JSON.stringify({
            type: 'answer',
            answer: answer,
            target: data.from,
            from: username
        }));
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

// UI 업데이트 함수들
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

function removeConnection(userId) {
    const pc = peerConnections.get(userId);
    if (pc) {
        pc.close();
        peerConnections.delete(userId);
    }
    
    const videoContainer = document.getElementById(`video-container-${userId}`);
    if (videoContainer) {
        videoContainer.remove();
    }
}

async function call(targetUser) {
    const pc = createPeerConnection(targetUser);
    peerConnections.set(targetUser, pc);
    
    try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        
        ws.send(JSON.stringify({
            type: 'offer', 
            offer: offer,
            target: targetUser,
            from: username
        }));
    } catch(err) {
        console.error('Error creating offer:', err);
    }
}