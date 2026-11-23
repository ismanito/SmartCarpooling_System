-- The least any rider pays for a Ride Now trip. Fuel is shared at 24 KES a km, so a one-kilometre hop would
-- otherwise cost about 12 KES, which is not a fair price for the driver's time. 30 KES is about a matatu fare.
INSERT INTO system_settings (setting_key, setting_value) VALUES ('min_share_kes', '30') ON CONFLICT (setting_key) DO NOTHING;
