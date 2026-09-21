import got from "got";
import Pino from "pino";

import makeWASocket, {
    Browsers,
    DisconnectReason,
    useMultiFileAuthState,
    fetchLatestBaileysVersion
} from "@whiskeysockets/baileys";

const bot_number="6283173655769";

async function start() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState("./tmp");
        const { version } = await fetchLatestBaileysVersion();

        const socket = makeWASocket({
            version,
            auth: state,
            logger: new Pino({ level: "silent" }),
            browser: Browsers.windows("Edge"),
            keepAliveIntervalMs: 30_000,
            markOnlineOnConnect: false,
            generateHighQualityLinkPreview: true,
            defaultQueryTimeoutMs: undefined,
            fireInitQueries: true
        });

        if (!state.creds.registered) {
            await new Promise(resolve => setTimeout(resolve, 3000));
            const code = await socket.requestPairingCode(bot_number.replace(/\D/g, ""));
            console.log(`Code: ${code.match(/.{1,4}/g)?.join("-")}`);
        }

        // save creds session
        socket.ev.on("creds.update", saveCreds);

        // connection update
        socket.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
            if (connection === "close") {
                const disconnectCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = disconnectCode !== DisconnectReason.loggedOut;

                if (shouldReconnect) {
                    setTimeout(() => {
                        start();
                    }, 2000);
                }
            }
        });

        socket.ev.on("messages.upsert", async ({ messages }) => {
            for (const m of messages) {
                if (!m.message) continue;

                m.body = [
                    m.message?.conversation,
                    m.message?.extendedTextMessage?.text,
                    m.message?.imageMessage?.caption,
                    m.message?.videoMessage?.caption,
                    m.message?.documentMessage?.caption,
                    m.message?.buttonsResponseMessage?.selectedButtonId,
                ].find(value => typeof value === "string" && value.trim())?.trim() || "";
    

                for (const [url] of m.body.matchAll(/https?:\/\/(?:vt|vm|www)?\.?tiktok\.com\/[^\s]+/gi)) {
                    try {
                        const { data } = await got.get(`https://www.tikwm.com/api/url?=${url}`).json();

                        if (Array.isArray(data?.images) && data.images.length) {
                            for (const image of data.images) {
                                await socket.sendMessage(m.key.remoteJid, {
                                    image: {
                                        url: image
                                    },
                                    mimeType: "video/mp4"
                                }, { quoted: m });
                            }
                            continue;
                        }

                        const video_url = data?.hdplay || data?.play;

                        if (video_url) {
                            await socket.sendMessage(m.key.remoteJid, {
                                video: {
                                    url: video_url
                                },
                                mimeType: "video/mp4"
                            }, { quoted: m });
                        }
                    } catch { }
                }
            }
        });
    } catch { }
}

start();
