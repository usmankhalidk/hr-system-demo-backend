import fs from 'fs/promises';
import path from 'path';

function getUploadsRoot(): string {
  return process.env.UPLOADS_DIR
    ? path.dirname(process.env.UPLOADS_DIR)
    : path.join(process.cwd(), 'uploads');
}

function buildGeneratedReportFilename(companyId: number, reportId: string, targetDate: Date): string {
  const isoStamp = targetDate.toISOString().replace(/[:.]/g, '-');
  return `company-${companyId}-${reportId}-${isoStamp}.pdf`;
}

export async function saveGeneratedReportPdf(
  companyId: number,
  reportId: string,
  targetDate: Date,
  pdfBuffer: Buffer,
): Promise<string> {
  const reportsDir = path.join(getUploadsRoot(), 'generated-reports');
  await fs.mkdir(reportsDir, { recursive: true });

  const filename = buildGeneratedReportFilename(companyId, reportId, targetDate);
  const absolutePath = path.join(reportsDir, filename);
  await fs.writeFile(absolutePath, pdfBuffer);

  return absolutePath;
}

export async function readGeneratedReportPdf(storagePath: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(storagePath);
  } catch {
    return null;
  }
}
