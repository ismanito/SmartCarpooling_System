-- 009_portals.sql - riders are students or university staff; drivers and admins are separate account types
ALTER TABLE users ADD COLUMN person_type text NOT NULL DEFAULT 'student' CHECK (person_type IN ('student', 'staff'));
