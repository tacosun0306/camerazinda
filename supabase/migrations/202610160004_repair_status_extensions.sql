alter type public.repair_status add value if not exists 'quote_pending_customer';
alter type public.repair_status add value if not exists 'waiting_customer';
alter type public.repair_status add value if not exists 'repair_completed';
alter type public.repair_status add value if not exists 'paused';
alter type public.repair_status add value if not exists 'repair_cancelled';
alter type public.repair_status add value if not exists 'unrepairable';