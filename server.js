const WebSocket = require('ws');
const NodeMediaServer = require('node-media-server');
const { spawn } = require('child_process');

// RTMP 서버 설정
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
        mediaroot: './media',
        allow_origin: '*'
    },
    trans: {
        ffmpeg: '/usr/local/bin/ffmpeg',
        tasks: [
            {
                app: 'live',
                hls: true,
                hlsFlags: '[hls_time=2:hls_list_size=3:hls_flags=delete_segments]'
            }
        ]
    }
});

// WebSocket 서버 설정
const wss = new WebSocket.Server({ port: 8080 });

// 클라이언트 관리
const streamers = new Map();  // username -> {ws, ffmpeg}
const viewers = new Map();    // username -> ws
const peers = new Map();      // username -> ws (WebRTC peers)

function startFFmpeg(streamKey) {
    const ffmpeg = spawn('ffmpeg', [
        '-i', '-',
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-f', 'flv',
        `rtmp://localhost/live/${streamKey}`
    ]);

    ffmpeg.stderr.on('data', (data) => {
        console.log(`FFmpeg: ${data}`);
    });

    return ffmpeg;
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
            // WebRTC 시그널링 메시지
            case 'offer':
            case 'answer':
            case 'ice-candidate':
                forwardMessage(data);
                break;
        }
    });

    ws.on('close', () => {
        handleDisconnect(ws);
    });
});

// 메시지 핸들러 함수들
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
        const ffmpeg = startFFmpeg(data.streamKey);
        streamer.ffmpeg = ffmpeg;
    }
}

function handleStreamData(data) {
    const streamer = streamers.get(data.username);
    if (streamer && streamer.ffmpeg) {
        const buffer = Buffer.from(data.chunk);
        streamer.ffmpeg.stdin.write(buffer);
    }
}

function handleStreamStop(data) {
    const streamer = streamers.get(data.username);
    if (streamer && streamer.ffmpeg) {
        streamer.ffmpeg.stdin.end();
        streamer.ffmpeg.kill();
        delete streamer.ffmpeg;
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
  // Find and remove disconnected user
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
  const users = [...streamers.keys(), ...peers.keys()];
  broadcast({
      type: 'users',
      users: users
  });
}

function broadcast(data) {
  const message = JSON.stringify(data);
  for (const conn of streamers.values()) {
      conn.ws.send(message);
  }
  for (const conn of peers.values()) {
      conn.send(message);
  }
}

function forwardMessage(data) {
  const target = data.target;
  const targetWs = peers.get(target) || streamers.get(target)?.ws;
  
  if (targetWs) {
      targetWs.send(JSON.stringify(data));
  }
}

// Start RTMP server
rtmpServer.run();

console.log('WebSocket server running on port 8080');
console.log('RTMP server running on port 1935');