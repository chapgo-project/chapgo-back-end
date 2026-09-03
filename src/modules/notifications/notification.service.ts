import { NotificationModel } from './notification.model.js';
import { UserModel } from '../users/user.model.js';
import { sendPush } from './push.service.js';

type NotificationInput = {
    userId: string;
    type: string;
    title: string;
    body: string;
    critical?: boolean;
    targetType?: string;
    targetId?: string;
    vehicleId?: unknown;
    preference: 'maintenance' | 'documents' | 'inspection' | 'checks' | 'garage' | 'mileagePrompt';
};

/** Creates a notification only when its user preference allows delivery. */
export async function createNotification(input: NotificationInput) {
    const user = await UserModel.findById(input.userId).select('notificationPrefs').lean();
    if (!user) return null;
    const notificationPrefs = user.notificationPrefs as Record<string, any> | undefined;
    if (notificationPrefs?.[input.preference] === false) return null;

    const digestPending = !input.critical && notificationPrefs?.dailyDigestEnabled !== false;
    const notification = await NotificationModel.create({
        ...input,
        preference: undefined,
        digestPending,
        digestKey: digestPending ? new Date().toISOString().slice(0, 10) : null,
    });

    if (!digestPending) {
        await sendPush({
            userId: input.userId,
            title: input.title,
            body: input.body,
            data: {
                notificationId: String(notification._id),
                type: input.type,
                ...(input.targetType ? { targetType: input.targetType } : {}),
                ...(input.targetId ? { targetId: input.targetId } : {}),
            },
        });
        await NotificationModel.updateOne({ _id: notification._id }, { pushSentAt: new Date() });
    }
    return notification;
}

/** Sends one summary push for each user's pending daily notification group. */
export async function flushDigestNotifications() {
    const groups = await NotificationModel.aggregate([
        { $match: { digestPending: true } },
        { $group: { _id: '$userId', count: { $sum: 1 }, latest: { $max: '$createdAt' } } },
    ]);
    let sent = 0;
    for (const group of groups) {
        const user = await UserModel.findById(group._id).select('notificationPrefs').lean();
        const notificationPrefs = user?.notificationPrefs as Record<string, any> | undefined;
        if (!user || notificationPrefs?.dailyDigestEnabled === false) continue;
        if ((notificationPrefs?.dailyDigestHour ?? 9) !== new Date().getUTCHours()) continue;
        await sendPush({
            userId: String(group._id),
            title: 'ChapGo',
            body: `${group.count} notification${group.count === 1 ? '' : 's'} à consulter`,
            data: { type: 'digest' },
        });
        await NotificationModel.updateMany(
            { userId: group._id, digestPending: true },
            { digestPending: false, pushSentAt: new Date() },
        );
        sent++;
    }
    return sent;
}
