export function toNotificationDto(n: Record<string, any>) {
    return {
        id: String(n._id),
        type: n.type,
        title: n.title,
        body: n.body,
        vehicleId: n.vehicleId ? String(n.vehicleId) : null,
        targetType: n.targetType ?? null,
        targetId: n.targetId ?? null,
        actions: [],
        readAt: n.readAt ?? null,
        createdAt: n.createdAt,
    };
}
