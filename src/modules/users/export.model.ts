import mongoose, { Schema, type InferSchemaType } from 'mongoose';

/**
 * One-time logbook dump. CSV (interchange) and PDF (readable report) live
 * here for 24 h so the owner can download them, and so an email link still
 * works after they leave the screen.
 */
const DataExportSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    tokenHash: { type: String, required: true, unique: true },
    csvFileName: { type: String, required: true },
    pdfFileName: { type: String, required: true },
    csv: { type: String, required: true },
    pdf: { type: Buffer, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true, collection: 'dataExports' },
);

DataExportSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
DataExportSchema.index({ userId: 1, createdAt: -1 });

export type DataExport = InferSchemaType<typeof DataExportSchema>;
export const DataExportModel =
  (mongoose.models.DataExport as mongoose.Model<DataExport> | undefined) ??
  mongoose.model<DataExport>('DataExport', DataExportSchema);
