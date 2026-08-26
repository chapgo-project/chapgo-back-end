import { Router } from 'express';
import { z } from 'zod';
import { handler, ok, okList } from '../../core/http.js';
import { validateBody, validateQuery, query } from '../../core/validate.js';
import { actorOf, requireAuth, requireLiveAccount } from '../../core/authMiddleware.js';
import { NotificationModel, DeviceTokenModel } from './notification.model.js';
import { toNotificationDto } from './notification.dto.js';

export const notificationRouter = Router();
notificationRouter.use(requireAuth, requireLiveAccount);

const ListQuery = z.object({
    critical: z.coerce.boolean().optional(),
    unread: z.coerce.boolean().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
});

notificationRouter.get(
    '/',
    validateQuery(ListQuery),
    handler(async (req, res) => {
        const q = query<typeof ListQuery>(req);
        const filter = {
            userId: actorOf(req).userId,
            ...(q.critical === undefined ? {} : { critical: q.critical }),
            ...(q.unread === undefined ? {} : { readAt: q.unread ? null : { $ne: null } }),
        };
        const items = await NotificationModel.find(filter).sort({ createdAt: -1 }).limit(q.limit).lean();
        return okList(res, items.map(toNotificationDto), { total: items.length });
    }),
);

notificationRouter.get(
    '/unread-count',
    handler(async (req, res) => {
        const count = await NotificationModel.countDocuments({ userId: actorOf(req).userId, readAt: null });
        return ok(res, { count });
    }),
);

notificationRouter.patch(
    '/:id/read',
    handler(async (req, res) => {
        await NotificationModel.updateOne(
            { _id: req.params.id, userId: actorOf(req).userId },
            { readAt: new Date() },
        );
        return ok(res, { success: true });
    }),
);

notificationRouter.post(
    '/read-all',
    handler(async (req, res) => {
        await NotificationModel.updateMany(
            { userId: actorOf(req).userId, readAt: null },
            { readAt: new Date() },
        );
        return ok(res, { success: true });
    }),
);

const DeviceBody = z.object({
    token: z.string().min(20).max(4096),
    platform: z.enum(['ios', 'android']),
});

notificationRouter.post(
    '/devices',
    validateBody(DeviceBody),
    handler(async (req, res) => {
        const token = await DeviceTokenModel.findOneAndUpdate(
            { token: req.body.token },
            { ...req.body, userId: actorOf(req).userId, lastSeenAt: new Date() },
            { upsert: true, new: true, setDefaultsOnInsert: true },
        );
        return ok(res, { id: String(token!._id) });
    }),
);

notificationRouter.delete(
    '/devices/:token',
    handler(async (req, res) => {
        await DeviceTokenModel.deleteOne({ token: req.params.token, userId: actorOf(req).userId });
        return ok(res, { success: true });
    }),
);
