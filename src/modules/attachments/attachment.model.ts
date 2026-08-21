import mongoose, { Schema, type InferSchemaType } from 'mongoose';
import { ATTACHMENT_OWNERS, ATTACHMENT_PURPOSES } from '../../types/enums.js';

/**
 * File METADATA only. Binaries live in object storage and never transit the
 * API — passing multipart through Node on Render would burn request time and
 * memory for no benefit, and large uploads on a slow connection would hit
 * the request timeout.
 */
const AttachmentSchema = new Schema(
  {
    /** Polymorphic owner: one collection for every file type in the product. */
    ownerType: { type: String, enum: ATTACHMENT_OWNERS, required: true },
    ownerId: { type: Schema.Types.ObjectId, default: null },
    purpose: { type: String, enum: ATTACHMENT_PURPOSES, required: true },

    storageKey: { type: String, required: true, unique: true },
    thumbnailKey: { type: String, default: null },

    filename: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    width: { type: Number, default: null },
    height: { type: Number, default: null },

    caption: { type: String, default: null, maxlength: 200 },

    uploadedById: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    uploadedAt: { type: Date, default: null },

    /**
     * pending → the signed URL was issued but nothing confirmed.
     * A nightly job deletes pending rows older than 24h: abandoned forms
     * leave orphans behind, and storage is billed either way.
     */
    status: { type: String, enum: ['pending', 'ready', 'failed'], default: 'pending' },
  },
  { timestamps: true, collection: 'attachments' },
);

AttachmentSchema.index({ ownerType: 1, ownerId: 1 });
AttachmentSchema.index({ status: 1, createdAt: 1 });

export type Attachment = InferSchemaType<typeof AttachmentSchema>;
export const AttachmentModel =
  mongoose.models.Attachment ?? mongoose.model('Attachment', AttachmentSchema);
