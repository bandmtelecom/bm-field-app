-- Optional dev seed — a few customers and a sample job so you can click around.
-- Safe to run after the migrations. Not needed in production.

insert into customers (name, code) values
  ('Lumen Technologies', 'Lumen'),
  ('Primoris', 'Primoris'),
  ('Oncor', 'Oncor'),
  ('Burns & McDonnell', 'BurnsMcD')
on conflict (code) do nothing;

insert into jobs (bm_number, customer_id, identifier, identifier_type, title, billing_mode, status)
select '26-408', c.id, 'N1090034', 'n_number', '101 W Abram St — Metron Ring 1', 'capital', 'open'
from customers c where c.code = 'Lumen'
on conflict (bm_number) do nothing;

insert into jobs (bm_number, customer_id, identifier, identifier_type, title, billing_mode, status)
select '26-298', c.id, 'LOR 34762086', 'lor', '2250 William D Tate (Grapevine)', 'emergency', 'open'
from customers c where c.code = 'Lumen'
on conflict (bm_number) do nothing;
