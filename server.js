const WebSocket = require('ws');
const NodeMediaServer = require('node-media-server');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const mediaPath = path.join(__dirname, 'media');
const livePath = path.join(mediaPath, 'live');

[mediaPath, livePath].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o777 });
    }
});

const rtmpServer = new NodeMediaServer({
    rtmp: {
        port: 1935,
        chunk_size: 60000,
        gop_cache: true,
        ping: 30,
        ping_timeout: 60
    },
    http: {
        port: 8000,
        mediaroot: mediaPath,
        allow_origin: '*',
        static: true
    }
});

const wss = new WebSocket.Server({ port: 8080 });
const streamers = new Map();
const viewers = new Map();
const peers = new Map();

function cleanupOldSegments(streamKey) {
    const streamPath = path.join(livePath, streamKey);
    if (fs.existsSync(streamPath)) {
        fs.readdir(streamPath, (err, files) => {
            if (err) return;
            files.forEach(file => {
                if (file.endsWith('.ts') || file.endsWith('.m3u8')) {
                    fs.unlink(path.join(streamPath, file), err => {
                        if (err) console.error(`Error deleting file: ${err}`);
                    });
                }
            });
        });
    }
}

function startFFmpeg(streamKey) {
    const streamPath = path.join(livePath, streamKey);
    if (!fs.existsSync(streamPath)) {
        fs.mkdirSync(streamPath, { recursive: true, mode: 0o777 });
    }

    const ffmpeg = spawn('ffmpeg', [
        '-fflags', '+igndts',
        '-i', '-',
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-ar', '44100',
        '-b:a', '64k',
        '-bufsize', '4M',
        '-f', 'flv',
        `rtmp://localhost/live/${streamKey}`,
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-f', 'hls',
        '-hls_time', '2',
        '-hls_list_size', '3',
        '-hls_flags', 'delete_segments+append_list+omit_endlist',
        '-hls_segment_type', 'mpegts',
        '-hls_init_time', '0',
        '-hls_playlist_type', 'event',
        '-hls_segment_filename', path.join(streamPath, 'index-%d.ts'),
        path.join(streamPath, 'index.m3u8')
    ]);

    // symlink 생성
    const publicPath = path.join(mediaPath, 'live', streamKey);
    if (!fs.existsSync(publicPath)) {
        try {
            fs.symlinkSync(streamPath, publicPath, 'dir');
        } catch (error) {
            console.error('Symlink error:', error);
        }
    }

    return ffmpeg;

    // ffmpeg.stderr.on('data', (data) => console.log(`FFmpeg: ${data}`));
    // ffmpeg.on('error', (error) => console.error('FFmpeg error:', error));
    
    // ffmpeg.stdin.on('error', (error) => {
    //     console.error('FFmpeg stdin error:', error);
    //     if (error.code === 'EPIPE') {
    //         ffmpeg.kill();
    //     }
    // });

    // return ffmpeg;
}

wss.on('connection', (ws) => {
    ws.on('message', async (message) => {
        const data = JSON.parse(message);
        console.log('Received:', data.type);

        switch(data.type) {
            case 'register':
                handleRegister(ws, data);
                break;
            case 'start-stream':
                handleStreamStart(ws, data);
                break;
            case 'stream-data':
                handleStreamData(data);
                break;
            case 'stop-stream':
                handleStreamStop(data);
                break;
            case 'viewer-join':
                handleViewerJoin(ws, data);
                break;
            case 'offer':
            case 'answer':
            case 'ice-candidate':
                forwardMessage(data);
                break;
        }
    });

    ws.on('close', () => handleDisconnect(ws));
    ws.on('error', (error) => console.error('WebSocket error:', error));
});

function handleRegister(ws, data) {
    const { username, isStreamer } = data;
    if (isStreamer) {
        streamers.set(username, { ws });
    } else {
        peers.set(username, ws);
    }
    broadcastUserList();
}

function handleStreamStart(ws, data) {
    const streamer = streamers.get(data.username);
    if (streamer) {
        if (streamer.ffmpeg) {
            streamer.ffmpeg.kill();
        }
        
        cleanupOldSegments(data.streamKey);
        const ffmpeg = startFFmpeg(data.streamKey);
        streamer.ffmpeg = ffmpeg;
        
        ffmpeg.on('close', (code) => {
            console.log(`FFmpeg process closed with code ${code}`);
            if (streamer.ffmpeg === ffmpeg) {
                delete streamer.ffmpeg;
            }
            broadcast({
                type: 'stream-info',
                streams: Array.from(streamers.keys())
            });
        });
        
        broadcast({
            type: 'stream-info',
            streams: Array.from(streamers.keys())
        });
    }
}

function handleStreamData(data) {
    const streamer = streamers.get(data.username);
    if (!streamer?.ffmpeg?.stdin?.writable) return;

    try {
        const buffer = Buffer.from(data.chunk);
        const writeSuccess = streamer.ffmpeg.stdin.write(buffer);
        
        if (!writeSuccess) {
            streamer.ffmpeg.stdin.once('drain', () => {
                handleStreamData(data);
            });
        }
    } catch (error) {
        console.error('Stream data handling error:', error);
        handleStreamStop(data);
    }
}

function handleStreamStop(data) {
    const streamer = streamers.get(data.username);
    if (streamer?.ffmpeg) {
        streamer.ffmpeg.stdin.end();
        streamer.ffmpeg.kill();
        delete streamer.ffmpeg;
        broadcast({
            type: 'stream-info',
            streams: Array.from(streamers.keys())
        });
    }
}

function handleViewerJoin(ws, data) {
    viewers.set(data.username, ws);
    ws.send(JSON.stringify({
        type: 'stream-info',
        streams: Array.from(streamers.keys())
    }));
}

function handleDisconnect(ws) {
    let disconnectedUser;
    
    for (const [username, conn] of streamers.entries()) {
        if (conn.ws === ws) {
            handleStreamStop({ username });
            streamers.delete(username);
            disconnectedUser = username;
            break;
        }
    }
    
    if (!disconnectedUser) {
        for (const [username, conn] of peers.entries()) {
            if (conn === ws) {
                peers.delete(username);
                disconnectedUser = username;
                break;
            }
        }
    }

    if (disconnectedUser) {
        broadcastUserList();
        broadcast({
            type: 'user-disconnected',
            username: disconnectedUser
        });
    }
}

function broadcastUserList() {
    broadcast({
        type: 'users',
        users: [...streamers.keys(), ...peers.keys()]
    });
}

function broadcast(data) {
    const message = JSON.stringify(data);
    [...streamers.values()].forEach(conn => conn.ws.send(message));
    [...peers.values()].forEach(conn => conn.send(message));
    [...viewers.values()].forEach(conn => conn.send(message));
}

function forwardMessage(data) {
    const targetWs = peers.get(data.target) || streamers.get(data.target)?.ws;
    if (targetWs) {
        targetWs.send(JSON.stringify(data));
    }
}

rtmpServer.run();
console.log('WebSocket server running on port 8080');
console.log('RTMP server running on port 1935');