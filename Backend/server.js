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
    switch (eventData.type) {
        case 'subscription':
            switch (eventData.message[0].type) {
                case 'resub':
                    // code to handle subscription events
                    console.log(`Neuer Resub von ${eventData.message[0].name} für ${eventData.message[0].months} Monate!`);
                    break;
                case 'subgift':
                    // code to handle bits events
                    console.log(`${eventData.message[0].gifter} hat ein Sub an ${eventData.message[0].name} verschenkt!`);
                    break;
                default:
                    // default case
                    console.log(eventData.message[0]);
                    break;
            }
            break;
        case 'bits':
            console.log(`Bits erhalten: ${eventData.message[0].amount} von ${eventData.message[0].name}`);
            break;
        case 'subMysteryGift':
            console.log(`Sub-Bombe: ${eventData.message[0].amount} von ${eventData.message[0].name}`);
            break;
        default:
            // Andere Event-Typen können hier behandelt werden
            console.log(eventData);
            break;
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