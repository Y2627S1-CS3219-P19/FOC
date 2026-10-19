-- Repair suppliers seeded before the seed CSV was re-encoded as UTF-8.
-- Each U+FFFD was a Windows-1252 right single quote (0x92), so restore an apostrophe.
UPDATE suppliers SET
  name                 = replace(name, chr(65533), ''''),
  facility_type        = replace(facility_type, chr(65533), ''''),
  building             = replace(building, chr(65533), ''''),
  location_description = replace(location_description, chr(65533), '''')
WHERE name LIKE '%' || chr(65533) || '%'
   OR facility_type LIKE '%' || chr(65533) || '%'
   OR building LIKE '%' || chr(65533) || '%'
   OR location_description LIKE '%' || chr(65533) || '%';
