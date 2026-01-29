import 'dotenv/config';
import { Server } from 'socket.io';
import { io as streamlabsClient } from 'socket.io-client';

// 1. Lokaler Socket.io Server für dein Frontend (Port 3000)
const io = new Server(3000, {
    cors: { origin: "*" } // Erlaubt Zugriff vom Browser
});

console.log("Lokaler Server läuft auf Port 3000...");

// 2. Verbindung zur Streamlabs API (Socket API)
const streamlabsToken = process.env.STREAMLABS_TOKEN;
const slSocket = streamlabsClient(`https://sockets.streamlabs.com?token=${streamlabsToken}`, {
    transports: ['websocket']
});

slSocket.on('connect', () => {
    console.log('Verbunden mit Streamlabs!');
});

// 3. Auf Events von Streamlabs reagieren
slSocket.on('event', (eventData) => {
    // Streamlabs sendet verschiedene Events (donations, subs, bits)
    console.log(eventData);
    if (eventData.for === 'twitch_account') {
        switch (eventData.type) {
            case 'subscription':
                // code to handle subscription events
                console.log(eventData.message);
                break;
            case 'bits':
                // code to handle bits events
                console.log(eventData.message);
                break;
            default:
                // default case
                console.log(eventData.message);
        }
    }
});

// Optional: Nachrichten vom Frontend empfangen (z.B. manuelles Hinzufügen von Zeit)
io.on('connection', (socket) => {
    console.log('Frontend verbunden');

    socket.on('manual-adjust', (data) => {
        console.log('Manuelle Korrektur:', data);
        io.emit('timer-update', data); // An alle Frontends weitersagen
    });
});