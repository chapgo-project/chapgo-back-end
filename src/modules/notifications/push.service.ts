import { JWT } from 'google-auth-library';
import { config } from '../../core/config.js';
import { logger } from '../../core/logger.js';
import { DeviceTokenModel } from './notification.model.js';

type PushPayload = {
    userId: string;
    title: string;
    body: string;
    data?: Record<string, string>;
};

const fcmScope = 'https://www.googleapis.com/auth/firebase.messaging';

function firebaseConfigured() {
    return Boolean(
        config.FIREBASE_PROJECT_ID &&
        config.FIREBASE_CLIENT_EMAIL &&
        config.FIREBASE_PRIVATE_KEY,
    );
}

/** Sends one FCM message per registered device. Missing Firebase config is a deliberate no-op locally. */
export async function sendPush(payload: PushPayload): Promise<void> {
    if (!firebaseConfigured()) return;

    const client = new JWT({
        email: config.FIREBASE_CLIENT_EMAIL,
        key: config.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        scopes: [fcmScope],
    });
    const token = await client.getAccessToken();
    if (!token.token) throw new Error('Firebase access token unavailable');

    const devices = await DeviceTokenModel.find({ userId: payload.userId }).lean();
    await Promise.all(
        devices.map(async (device) => {
            const response = await fetch(
                `https://fcm.googleapis.com/v1/projects/${config.FIREBASE_PROJECT_ID}/messages:send`,
                {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token.token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        message: {
                            token: device.token,
                            notification: { title: payload.title, body: payload.body },
                            data: payload.data ?? {},
                        },
                    }),
                },
            );

            if (response.ok) return;
            if (response.status === 404 || response.status === 400) {
                await DeviceTokenModel.deleteOne({ _id: device._id });
                return;
            }
            logger.warn({ status: response.status, tokenId: String(device._id) }, 'FCM delivery failed');
        }),
    );
}
