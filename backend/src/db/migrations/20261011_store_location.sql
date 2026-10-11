UPDATE app.store_settings
SET address = 'Abangan Norte 599'
WHERE address IS NULL
   OR BTRIM(address) = ''
   OR address = '123 Main Street, City Center';
