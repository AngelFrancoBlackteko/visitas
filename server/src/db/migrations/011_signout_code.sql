-- v1.9 — adds visits.signout_code, a random secret printed as a QR on the
-- visitor badge. Kiosk self sign-out uses it instead of the sequential visit
-- id, so nobody on the network can sign out someone else by guessing ids.
--
-- Kept separate from public_token on purpose: public_token unlocks the
-- badge page and the visitor photo, while signout_code only ends the visit.
-- A badge QR that leaves the building should not grant photo access.

ALTER TABLE visits ADD COLUMN signout_code TEXT;

UPDATE visits
   SET signout_code = lower(hex(randomblob(16)))
 WHERE signout_code IS NULL;

CREATE UNIQUE INDEX idx_visits_signout_code ON visits(signout_code);
