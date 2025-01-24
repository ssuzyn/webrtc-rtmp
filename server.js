const WebSocket = require('ws');
const server = new WebSocket.Server({ port: 3000 });

const users = new Map();

server.on('connection', (socket) => {
    const userId = generateUserId();
    
    socket.on('message', (message) => {
        const data = JSON.parse(message);
        
        switch(data.type) {
            case 'join':
                users.set(userId, {
                    socket: socket,
                    username: data.username
                });
                
                // Notify existing users
                users.forEach((user, id) => {
                    if (id !== userId) {
                        user.socket.send(JSON.stringify({
                            type: 'user-joined',
                            userId: userId,
                            username: data.username
                        }));
                    }
                });
                break;
                
            case 'offer':
            case 'answer':
            case 'ice-candidate':
                const targetUser = users.get(data.userId);
                if (targetUser) {
                    data.userId = userId;
                    targetUser.socket.send(JSON.stringify(data));
                }
                break;
                
            case 'leave':
                users.delete(userId);
                broadcastUserLeft(userId);
                break;
        }
    });
    
    socket.on('close', () => {
        users.delete(userId);
        broadcastUserLeft(userId);
    });
});

function generateUserId() {
    return Math.random().toString(36).substr(2, 9);
}

function broadcastUserLeft(userId) {
    users.forEach((user) => {
        user.socket.send(JSON.stringify({
            type: 'user-left',
            userId: userId
        }));
    });
}