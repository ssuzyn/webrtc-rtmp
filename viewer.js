let ws;
let username;

function joinAsViewer() {
    username = document.getElementById('username').value;
    if (!username) return;
    
    ws = new WebSocket('ws://localhost:8080');
    
    ws.onopen = () => {
        ws.send(JSON.stringify({
            type: 'viewer-join',
            username: username
        }));
        document.getElementById('username').disabled = true;
    };
    
    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'stream-info') {
            updateStreamPlayers(data.streams);
        }
    };

    ws.onclose = () => setTimeout(joinAsViewer, 1000);
    ws.onerror = (error) => console.error('WebSocket error:', error);
}

function updateStreamPlayers(streams) {
    const container = document.getElementById('streamPlayers');
    container.innerHTML = '';
    
    streams.forEach(stream => createHLSPlayer(stream));
}

function createHLSPlayer(streamKey) {
    const container = document.getElementById('streamPlayers');
    const playerDiv = document.createElement('div');
    playerDiv.id = `stream-${streamKey}`;
    playerDiv.className = 'bg-black rounded-lg overflow-hidden';
    
    const video = document.createElement('video');
    video.className = 'w-full h-auto';
    video.controls = true;
    video.autoplay = true;
    video.playsInline = true;
    
    if (Hls.isSupported()) {
        const hls = new Hls({
            debug: true,  // 디버깅 활성화
            enableWorker: true,
            backBufferLength: 0,
            manifestLoadingTimeOut: 20000,
            manifestLoadingMaxRetry: 3,
            levelLoadingTimeOut: 20000,
            levelLoadingMaxRetry: 3
        });
        
        const manifestUrl = `http://localhost:8000/live/${encodeURIComponent(streamKey)}/index.m3u8`;
        console.log('Loading manifest:', manifestUrl);
        
        hls.loadSource(manifestUrl);
        hls.attachMedia(video);
        
        hls.on(Hls.Events.ERROR, (event, data) => {
            console.error('HLS error:', data);
            if (data.fatal) {
                switch (data.type) {
                    case Hls.ErrorTypes.NETWORK_ERROR:
                        console.log('Network error, trying to recover...');
                        hls.startLoad();
                        break;
                    case Hls.ErrorTypes.MEDIA_ERROR:
                        console.log('Media error, trying to recover...');
                        hls.recoverMediaError();
                        break;
                }
            }
        });
    }
    
    playerDiv.appendChild(video);
    container.appendChild(playerDiv);
}