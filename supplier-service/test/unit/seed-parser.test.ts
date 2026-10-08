import { describe, it, expect } from 'vitest';
import { parseSeedCsv } from '../../src/db/seedParser.js';

describe('Slice 2: Seed CSV Parser', () => {
  it('parses CSV rows into typed 3NF supplier records', () => {
    const csvContent = `Name,Type,Building,Floor,Location Description,Latitude,Longitude,StartingTime,ClosingTime,ImageURL
Cool Spot,Food,Com2,1,Opp LT16,1.2940156,103.7738478,0900hrs,2130hrs,https://example.com/COOL_SPOT.jpeg`;

    const records = parseSeedCsv(csvContent);
    expect(records).toHaveLength(1);
    expect(records[0]).toEqual({
      name: 'Cool Spot',
      facilityType: 'Food',
      building: 'Com2',
      floor: '1',
      locationDescription: 'Opp LT16',
      latitude: 1.2940156,
      longitude: 103.7738478,
      opensAt: '09:00',
      closesAt: '21:30',
      imageUrl: 'https://example.com/COOL_SPOT.jpeg',
    });
  });

  it('correctly converts 4-digit hours format (e.g. 0900hrs -> 09:00, 0000hrs -> 00:00, 2359hrs -> 23:59)', () => {
    const csvContent = `Name,Type,Building,Floor,Location Description,Latitude,Longitude,StartingTime,ClosingTime,ImageURL
Printer @ Com 2,Printing,Com 2,1,Next to LT19,1.2938347,103.7744572,0000hrs,2359hrs,`;

    const records = parseSeedCsv(csvContent);
    expect(records[0]?.opensAt).toBe('00:00');
    expect(records[0]?.closesAt).toBe('23:59');
    expect(records[0]?.imageUrl).toBeNull();
  });

  it('handles overnight hours and quotes in location description', () => {
    const csvContent = `Name,Type,Building,Floor,Location Description,Latitude,Longitude,StartingTime,ClosingTime,ImageURL
Supersnacks,Food,Prince George's Park,1,"At level 1 in Prince George's Park Residences, Block 10",1.2913847,103.7776367,1100hrs,0200hrs,`;

    const records = parseSeedCsv(csvContent);
    expect(records[0]?.opensAt).toBe('11:00');
    expect(records[0]?.closesAt).toBe('02:00');
    expect(records[0]?.locationDescription).toBe("At level 1 in Prince George's Park Residences, Block 10");
  });

  it('parses the actual seed CSV file containing 21 records', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const realCsvPath = path.resolve(__dirname, '../../../data/csv/supplier-seed-data.csv');
    const content = fs.readFileSync(realCsvPath, 'utf8');

    const records = parseSeedCsv(content);
    expect(records).toHaveLength(21);
    expect(records.every((r) => r.opensAt.length === 5 && r.closesAt.length === 5)).toBe(true);
  });
});
