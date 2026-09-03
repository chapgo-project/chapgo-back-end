import crypto from 'node:crypto';
import type { Request } from 'express';
import { err, ErrorCode } from '../../core/errors.js';
import { generateLinkToken, messenger } from '../../core/messaging.js';
import { verifyPassword } from '../../core/password.js';
import { revokeAllSessions } from '../auth/auth.service.js';
import { AccessModel } from '../access/access.model.js';
import { DocumentModel } from '../documents/document.model.js';
import { IssueModel } from '../issues/issue.model.js';
import { MaintenanceModel } from '../maintenance/maintenance.model.js';
import { MileageModel } from '../mileage/mileage.model.js';
import { DeviceTokenModel } from '../notifications/notification.model.js';
import { ReminderModel } from '../reminders/reminder.model.js';
import { OwnershipModel } from '../vehicles/ownership.model.js';
import { VehicleModel } from '../vehicles/vehicle.model.js';
import { snapshotFromCollections, toCsv, toPdf } from './export.format.js';
import { DataExportModel } from './export.model.js';
import { UserModel } from './user.model.js';
import { purgeStoredAvatar } from './avatar.service.js';

const EXPORT_TTL_MS = 24 * 60 * 60 * 1000;

function asBuffer(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (value && typeof value === 'object' && 'buffer' in value && Buffer.isBuffer((value as { buffer: Buffer }).buffer)) {
    return (value as { buffer: Buffer }).buffer;
  }
  return Buffer.from(value as Uint8Array);
}

export type ExportDownloadFormat = 'csv' | 'pdf';

function publicApiBase(req: Request): string {
  const proto = req.headers['x-forwarded-proto']?.toString().split(',')[0]?.trim() || req.protocol;
  const host = req.get('host') ?? '127.0.0.1:3000';
  return `${proto}://${host}/api/v1`;
}

export async function buildLogbookExport(userId: string) {
  const user = await UserModel.findById(userId)
    .select('firstName lastName email preferences.currency')
    .lean();
  if (!user) throw err.unauthenticated();

  const ownerships = await OwnershipModel.find({ userId }).lean();
  const vehicleIds = ownerships.map((o) => o.vehicleId);

  const [vehicles, mileage, maintenance, documents, issues, reminders] = await Promise.all([
    VehicleModel.find({ _id: { $in: vehicleIds } }).lean(),
    MileageModel.find({ vehicleId: { $in: vehicleIds } }).sort({ recordedAt: 1 }).lean(),
    MaintenanceModel.find({ vehicleId: { $in: vehicleIds }, deletedAt: null })
      .sort({ performedAt: 1 })
      .lean(),
    DocumentModel.find({ vehicleId: { $in: vehicleIds } }).lean(),
    IssueModel.find({ vehicleId: { $in: vehicleIds } }).lean(),
    ReminderModel.find({ vehicleId: { $in: vehicleIds } }).lean(),
  ]);

  return snapshotFromCollections({
    account: user,
    vehicles,
    mileage,
    maintenance,
    documents,
    issues,
    reminders,
    currency: user.preferences?.currency,
  });
}

export async function requestLogbookExport(userId: string, req: Request) {
  const snapshot = await buildLogbookExport(userId);
  const csv = toCsv(snapshot);
  const pdf = toPdf(snapshot);
  const { token, hash } = generateLinkToken();
  const day = new Date().toISOString().slice(0, 10);
  const csvFileName = `chapgo-carnets-${day}.csv`;
  const pdfFileName = `chapgo-carnets-${day}.pdf`;
  const expiresAt = new Date(Date.now() + EXPORT_TTL_MS);

  await DataExportModel.create({
    userId,
    tokenHash: hash,
    csvFileName,
    pdfFileName,
    csv,
    pdf,
    expiresAt,
  });

  const base = `${publicApiBase(req)}/exports/${token}`;
  const csvDownloadUrl = `${base}?format=csv`;
  const pdfDownloadUrl = `${base}?format=pdf`;
  const user = await UserModel.findById(userId).select('email').lean();
  let emailed = false;

  if (user?.email) {
    try {
      await messenger.sendEmail(
        user.email,
        'Votre export ChapGo',
        `Votre export de carnets est prêt (CSV pour Excel, PDF à partager). Les liens expirent dans 24 heures :\n\nCSV : ${csvDownloadUrl}\nPDF : ${pdfDownloadUrl}`,
      );
      emailed = true;
    } catch {
      emailed = false;
    }
  }

  return {
    csvDownloadUrl,
    pdfDownloadUrl,
    csvFileName,
    pdfFileName,
    downloadUrl: csvDownloadUrl,
    fileName: csvFileName,
    expiresAt: expiresAt.toISOString(),
    emailed,
  };
}

export async function downloadLogbookExport(rawToken: string, format: ExportDownloadFormat = 'csv') {
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const record = await DataExportModel.findOne({ tokenHash }).lean();
  if (!record || record.expiresAt.getTime() < Date.now()) {
    throw err.custom(410, ErrorCode.TOKEN_EXPIRED, 'Ce lien d\'export a expiré.');
  }
  if (format === 'pdf') {
    return {
      fileName: record.pdfFileName,
      contentType: 'application/pdf',
      body: asBuffer(record.pdf),
    };
  }
  return {
    fileName: record.csvFileName,
    contentType: 'text/csv; charset=utf-8',
    body: record.csv,
  };
}

export async function deleteAccount(userId: string, password?: string) {
  const user = await UserModel.findById(userId);
  if (!user) throw err.unauthenticated();

  if (user.passwordHash) {
    const valid = password ? await verifyPassword(user.passwordHash, password) : false;
    if (!valid) {
      throw err.custom(401, ErrorCode.INVALID_CREDENTIALS, 'Mot de passe incorrect.', {
        field: 'password',
      });
    }
  }

  await OwnershipModel.updateMany({ userId, endedAt: null }, { endedAt: new Date() });
  await AccessModel.updateMany(
    { ownerUserId: userId, status: 'approved' },
    { status: 'revoked', revokedAt: new Date() },
  );
  await DeviceTokenModel.deleteMany({ userId });

  user.firstName = 'Compte';
  user.lastName = 'supprimé';
  user.email = null;
  user.pendingEmail = null;
  user.phone = null;
  user.pendingPhone = null;
  user.passwordHash = null;
  user.googleId = null;
  user.photoId = null;
  await purgeStoredAvatar(user.avatarPublicId);
  user.avatarPublicId = null;
  user.avatarVersion = null;
  user.deletedAt = new Date();
  await user.save();

  await revokeAllSessions(userId);
}
