export type ExportKind = 'odometer' | 'fuel' | 'maintenance' | 'document' | 'issue' | 'reminder';

export type LogbookRow = {
  date: string;
  vehicle: string;
  plate: string;
  odometer: string;
  kind: ExportKind;
  fuel: string;
  cost: string;
  currency: string;
  maintenance: string;
  notes: string;
};

export type LogbookVehicle = {
  name: string;
  plate: string;
  year: string;
  fuel: string;
  odometer: string;
};

export type LogbookSnapshot = {
  exportedAt: string;
  accountName: string;
  accountEmail: string;
  vehicles: LogbookVehicle[];
  rows: LogbookRow[];
};

const CSV_HEADER = [
  'Date',
  'Vehicle',
  'Plate',
  'Odometer',
  'Kind',
  'Fuel',
  'Cost',
  'Currency',
  'Maintenance',
  'Notes',
] as const;

export function isoDate(value: unknown): string {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

export function csvCell(value: unknown): string {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(snapshot: LogbookSnapshot): string {
  const lines = [
    '## Vehicles',
    ['Name', 'Plate', 'Year', 'Fuel', 'Odometer'].join(','),
    ...snapshot.vehicles.map((v) =>
      [v.name, v.plate, v.year, v.fuel, v.odometer].map(csvCell).join(','),
    ),
    '',
    '## Log',
    CSV_HEADER.join(','),
    ...snapshot.rows.map((r) =>
      [
        r.date,
        r.vehicle,
        r.plate,
        r.odometer,
        r.kind,
        r.fuel,
        r.cost,
        r.currency,
        r.maintenance,
        r.notes,
      ]
        .map(csvCell)
        .join(','),
    ),
  ];
  return `\uFEFF${lines.join('\n')}\n`;
}

function vehicleLabel(v: { brand?: unknown; model?: unknown }): string {
  return [v.brand, v.model].filter(Boolean).join(' ').trim() || 'Véhicule';
}

function num(value: unknown): string {
  if (value == null || value === '') return '';
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? String(n) : '';
}

type LeanId = { toString(): string };

function idOf(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null && 'toString' in value) {
    return (value as LeanId).toString();
  }
  return String(value);
}

/**
 * One interchange row per event. Fuelio-style: date, odometer, fuel, cost,
 * maintenance sit on the same row so Excel / other apps can re-import.
 */
export function snapshotFromCollections(input: {
  exportedAt?: Date;
  account: { firstName?: string | null; lastName?: string | null; email?: string | null };
  vehicles: Array<Record<string, unknown>>;
  mileage: Array<Record<string, unknown>>;
  maintenance: Array<Record<string, unknown>>;
  documents: Array<Record<string, unknown>>;
  issues: Array<Record<string, unknown>>;
  reminders: Array<Record<string, unknown>>;
  currency?: string;
}): LogbookSnapshot {
  const currency = input.currency || 'XOF';
  const byId = new Map(input.vehicles.map((v) => [idOf(v._id), v]));
  const lookup = (vehicleId: unknown) => {
    const v = byId.get(idOf(vehicleId));
    return {
      name: v ? vehicleLabel(v) : '',
      plate: v ? String(v.plate ?? '') : '',
    };
  };

  const rows: LogbookRow[] = [];

  for (const m of input.mileage) {
    if (m.maintenanceEventId) continue;
    const v = lookup(m.vehicleId);
    rows.push({
      date: isoDate(m.recordedAt),
      vehicle: v.name,
      plate: v.plate,
      odometer: num(m.value),
      kind: 'odometer',
      fuel: '',
      cost: '',
      currency,
      maintenance: '',
      notes: [m.source, m.note].filter(Boolean).join(' · '),
    });
  }

  for (const e of input.maintenance) {
    const v = lookup(e.vehicleId);
    rows.push({
      date: isoDate(e.performedAt),
      vehicle: v.name,
      plate: v.plate,
      odometer: num(e.mileage),
      kind: 'maintenance',
      fuel: '',
      cost: num(e.cost),
      currency: String(e.currency || currency),
      maintenance: String(e.title ?? ''),
      notes: [e.category, e.garageName, e.description].filter(Boolean).join(' · '),
    });
  }

  for (const d of input.documents) {
    const v = lookup(d.vehicleId);
    rows.push({
      date: isoDate(d.issuedAt ?? d.createdAt),
      vehicle: v.name,
      plate: v.plate,
      odometer: '',
      kind: 'document',
      fuel: '',
      cost: '',
      currency,
      maintenance: String(d.label ?? d.type ?? ''),
      notes: [d.reference, d.issuer].filter(Boolean).join(' · '),
    });
  }

  for (const i of input.issues) {
    const v = lookup(i.vehicleId);
    rows.push({
      date: isoDate(i.reportedAt),
      vehicle: v.name,
      plate: v.plate,
      odometer: num(i.reportedMileage),
      kind: 'issue',
      fuel: '',
      cost: '',
      currency,
      maintenance: String(i.title ?? ''),
      notes: [i.severity, i.status, i.description].filter(Boolean).join(' · '),
    });
  }

  for (const r of input.reminders) {
    const v = lookup(r.vehicleId);
    rows.push({
      date: isoDate(r.dueDate ?? r.createdAt),
      vehicle: v.name,
      plate: v.plate,
      odometer: num(r.dueMileage),
      kind: 'reminder',
      fuel: '',
      cost: '',
      currency,
      maintenance: String(r.label ?? ''),
      notes: [r.category, r.status].filter(Boolean).join(' · '),
    });
  }

  rows.sort((a, b) => a.date.localeCompare(b.date) || a.plate.localeCompare(b.plate));

  return {
    exportedAt: (input.exportedAt ?? new Date()).toISOString(),
    accountName: [input.account.firstName, input.account.lastName].filter(Boolean).join(' ').trim(),
    accountEmail: input.account.email ?? '',
    vehicles: input.vehicles.map((v) => ({
      name: vehicleLabel(v),
      plate: String(v.plate ?? ''),
      year: num(v.year),
      fuel: String(v.fuel ?? ''),
      odometer: num(v.currentMileage),
    })),
    rows,
  };
}

const KIND_FR: Record<ExportKind, string> = {
  odometer: 'Kilométrage',
  fuel: 'Carburant',
  maintenance: 'Entretien',
  document: 'Document',
  issue: 'Anomalie',
  reminder: 'Rappel',
};

function wrapLine(text: string, width = 92): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let current = words[0]!;
  for (const word of words.slice(1)) {
    if (`${current} ${word}`.length > width) {
      lines.push(current);
      current = word;
    } else {
      current = `${current} ${word}`;
    }
  }
  lines.push(current);
  return lines;
}

function pdfUtf16Hex(text: string): string {
  const buf = Buffer.alloc(2 + text.length * 2);
  buf.writeUInt16BE(0xfeff, 0);
  for (let i = 0; i < text.length; i++) buf.writeUInt16BE(text.charCodeAt(i), 2 + i * 2);
  return `<${buf.toString('hex')}>`;
}

function reportLines(snapshot: LogbookSnapshot): string[] {
  const lines = [
    'ChapGo — carnet de santé',
    `Exporté le ${isoDate(snapshot.exportedAt)}`,
  ];
  const who = [snapshot.accountName, snapshot.accountEmail].filter(Boolean).join(' · ');
  if (who) lines.push(who);
  lines.push('');

  if (snapshot.vehicles.length === 0) {
    lines.push('Aucun véhicule dans ce compte.');
    return lines;
  }

  for (const vehicle of snapshot.vehicles) {
    lines.push(`${vehicle.name}  ·  ${vehicle.plate}`);
    const meta = [vehicle.year, vehicle.fuel, vehicle.odometer ? `${vehicle.odometer} km` : '']
      .filter(Boolean)
      .join(' · ');
    if (meta) lines.push(meta);

    const events = snapshot.rows.filter((r) => r.plate === vehicle.plate);
    if (events.length === 0) lines.push('Aucune entrée.');
    for (const row of events) {
      const left = [row.date, row.odometer ? `${row.odometer} km` : '', KIND_FR[row.kind]]
        .filter(Boolean)
        .join('  ·  ');
      lines.push(...wrapLine(left));
      const detail = [
        row.maintenance,
        row.fuel ? `${row.fuel} L` : '',
        row.cost ? `${row.cost} ${row.currency}`.trim() : '',
        row.notes,
      ]
        .filter(Boolean)
        .join('  ·  ');
      if (detail) {
        for (const wrapped of wrapLine(detail)) lines.push(`  ${wrapped}`);
      }
    }
    lines.push('');
  }
  return lines;
}

/** Readable report for sharing. Not an interchange format. */
export function toPdf(snapshot: LogbookSnapshot): Buffer {
  const all = reportLines(snapshot);
  const perPage = 48;
  const pages: string[][] = [];
  for (let i = 0; i < all.length; i += perPage) pages.push(all.slice(i, i + perPage));
  if (pages.length === 0) pages.push(['ChapGo']);

  const pageIds = pages.map((_, i) => 3 + i);
  const contentIds = pages.map((_, i) => 3 + pages.length + i);
  const fontId = 3 + pages.length * 2;
  const objects: string[] = [];

  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(
    `<< /Type /Pages /Count ${pages.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] >>`,
  );

  pages.forEach((lines, i) => {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentIds[i]} 0 R >>`,
    );
    const ops = [
      'BT',
      '/F1 11 Tf',
      '14 TL',
      '48 800 Td',
      ...lines.flatMap((line, idx) => {
        const show = `${pdfUtf16Hex(line)} Tj`;
        return idx === 0 ? [show] : ['T*', show];
      }),
      'ET',
    ].join('\n');
    objects.push(`<< /Length ${Buffer.byteLength(ops, 'utf8')} >>\nstream\n${ops}\nendstream`);
  });

  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  const header = Buffer.from('%PDF-1.4\n');
  const parts: Buffer[] = [header];
  const offsets = [0];
  let total = header.length;
  objects.forEach((obj, i) => {
    offsets.push(total);
    const block = Buffer.from(`${i + 1} 0 obj\n${obj}\nendobj\n`);
    parts.push(block);
    total += block.length;
  });
  const xrefLines = ['xref', `0 ${objects.length + 1}`, '0000000000 65535 f '];
  for (let i = 1; i <= objects.length; i++) {
    xrefLines.push(`${String(offsets[i]).padStart(10, '0')} 00000 n `);
  }
  parts.push(
    Buffer.from(
      `${xrefLines.join('\n')}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${total}\n%%EOF\n`,
    ),
  );
  return Buffer.concat(parts);
}
