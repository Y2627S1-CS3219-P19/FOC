import { parse } from 'csv-parse/sync';

export interface SeedSupplierRecord {
  name: string;
  facilityType: string;
  building: string;
  floor: string | null;
  locationDescription: string | null;
  latitude: number | null;
  longitude: number | null;
  opensAt: string;
  closesAt: string;
  imageUrl: string | null;
}

interface RawCsvRow {
  Name?: string;
  Type?: string;
  Building?: string;
  Floor?: string;
  'Location Description'?: string;
  Latitude?: string;
  Longitude?: string;
  StartingTime?: string;
  ClosingTime?: string;
  ImageURL?: string;
}

/**
 * Normalizes time string from CSV (e.g. "0900hrs" or "900hrs") into 24h "HH:MM" format.
 */
function normalizeCsvTime(rawTime: string | undefined, defaultTime: string): string {
  if (!rawTime) return defaultTime;
  const digits = rawTime.replace(/\D/g, '');
  if (digits.length === 4) {
    return `${digits.slice(0, 2)}:${digits.slice(2, 4)}`;
  } else if (digits.length === 3) {
    return `0${digits.slice(0, 1)}:${digits.slice(1, 3)}`;
  }
  return defaultTime;
}

/**
 * Parses raw CSV contents into typed supplier records conforming to strict 3NF schema.
 */
export function parseSeedCsv(csvString: string): SeedSupplierRecord[] {
  const records = parse(csvString, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as RawCsvRow[];

  return records.map((row) => {
    const lat = row.Latitude ? parseFloat(row.Latitude) : null;
    const lng = row.Longitude ? parseFloat(row.Longitude) : null;

    return {
      name: row.Name ?? '',
      facilityType: row.Type ?? '',
      building: row.Building ?? '',
      floor: row.Floor ? row.Floor : null,
      locationDescription: row['Location Description'] ? row['Location Description'] : null,
      latitude: lat !== null && !isNaN(lat) ? lat : null,
      longitude: lng !== null && !isNaN(lng) ? lng : null,
      opensAt: normalizeCsvTime(row.StartingTime, '09:00'),
      closesAt: normalizeCsvTime(row.ClosingTime, '21:00'),
      imageUrl: row.ImageURL && row.ImageURL.trim() ? row.ImageURL.trim() : null,
    };
  });
}
