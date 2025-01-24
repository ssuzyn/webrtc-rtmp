const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }
    ]
};

let localStream;
let peers = {};
let username = '';
let socket;
let isAudioMuted = false;
let isVideoOff = false;

async function joinRoom() {
    username = document.getElementById('username').value;
    if (!username) return alert('Please enter your name');
    
    document.getElementById('joinForm').style.display = 'none';
    
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: true
        });
        
        addVideoStream('local', localStream, username);
        
        socket = new WebSocket('ws://localhost:3000');
        socket.onopen = () => {
            socket.send(JSON.stringify({
                type: 'join',
                username: username
            }));
        };
        
        socket.onmessage = handleSignalingMessage;
        
    } catch (err) {
        console.error('Error accessing media devices:', err);
    }
}

function handleSignalingMessage(event) {
    const message = JSON.parse(event.data);
    
    switch(message.type) {
        case 'user-joined':
            createPeerConnection(message.userId, message.username);
            break;
            
        case 'offer':
            handleOffer(message);
            break;
            
        case 'answer':
            handleAnswer(message);
            break;
            
        case 'ice-candidate':
            handleIceCandidate(message);
            break;
            
        case 'user-left':
            removePeer(message.userId);
            break;
    }
}

function createPeerConnection(userId, remoteUsername) {
    const peer = new RTCPeerConnection(configuration);
    
    peer.onicecandidate = event => {
        if (event.candidate) {
            socket.send(JSON.stringify({
                type: 'ice-candidate',
                candidate: event.candidate,
                userId: userId
            }));
        }
    };
    
    peer.ontrack = event => {
        if (!document.getElementById(`video-${userId}`)) {
            addVideoStream(userId, event.streams[0], remoteUsername);
        }
    };
    
    localStream.getTracks().forEach(track => {
        peer.addTrack(track, localStream);
    });
    
    peers[userId] = peer;
    
    peer.createOffer()
        .then(offer => peer.setLocalDescription(offer))
        .then(() => {
            socket.send(JSON.stringify({
                type: 'offer',
                offer: peer.localDescription,
                userId: userId
            }));
        });
}

async function handleOffer(message) {
    const peer = new RTCPeerConnection(configuration);
    
    peer.onicecandidate = event => {
        if (event.candidate) {
            socket.send(JSON.stringify({
                type: 'ice-candidate',
                candidate: event.candidate,
                userId: message.userId
            }));
        }
    };
    
    peer.ontrack = event => {
        if (!document.getElementById(`video-${message.userId}`)) {
            addVideoStream(message.userId, event.streams[0], message.username);
        }
    };
    
    localStream.getTracks().forEach(track => {
        peer.addTrack(track, localStream);
    });
    
    peers[message.userId] = peer;
    
    await peer.setRemoteDescription(message.offer);
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    
    socket.send(JSON.stringify({
        type: 'answer',
        answer: answer,
        userId: message.userId
    }));
}

function handleAnswer(message) {
    peers[message.userId].setRemoteDescription(message.answer);
}

function handleIceCandidate(message) {
    peers[message.userId].addIceCandidate(new RTCIceCandidate(message.candidate));
}

function addVideoStream(userId, stream, username) {
    const videoContainer = document.createElement('div');
    videoContainer.className = 'videoContainer';
    videoContainer.id = `container-${userId}`;
    
    const video = document.createElement('video');
    video.id = `video-${userId}`;
    video.srcObject = stream;
    video.autoplay = true;
    video.playsInline = true;
    if (userId === 'local') video.muted = true;
    
    const usernameDiv = document.createElement('div');
    usernameDiv.className = 'username';
    usernameDiv.textContent = username;
    
    videoContainer.appendChild(video);
    videoContainer.appendChild(usernameDiv);
    document.getElementById('videoGrid').appendChild(videoContainer);
}

function removePeer(userId) {
    if (peers[userId]) {
        peers[userId].close();
        delete peers[userId];
    }
    
    const videoContainer = document.getElementById(`container-${userId}`);
    if (videoContainer) videoContainer.remove();
}

function toggleMute() {
    isAudioMuted = !isAudioMuted;
    localStream.getAudioTracks().forEach(track => {
        track.enabled = !isAudioMuted;
    });
}

function toggleVideo() {
    isVideoOff = !isVideoOff;
    localStream.getVideoTracks().forEach(track => {
        track.enabled = !isVideoOff;
    });
}

function leaveRoom() {
    if (socket) {
        socket.send(JSON.stringify({ type: 'leave' }));
        socket.close();
    }
    
    Object.values(peers).forEach(peer => peer.close());
    peers = {};
    
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    
    document.getElementById('videoGrid').innerHTML = '';
    document.getElementById('joinForm').style.display = 'block';
}