import { Router } from 'express';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from '../config.js';
import { pickLocalized } from '../i18n/index.js';

const router = Router();

const FORM_PATH = resolve(config.repoRoot, 'config/visitor-form.json');

// Default-ships to a sensible field set if config/visitor-form.json is absent.
const DEFAULT_FORM = {
  fields: [
    { key: 'name',    label: { es: 'Su nombre', en: 'Your name' },                       type: 'text',            required: true },
    { key: 'company', label: { es: 'Empresa', en: 'Company' },                           type: 'text',            required: false },
    { key: 'email',   label: { es: 'Correo electrónico', en: 'Email' },                  type: 'email',           required: false },
    { key: 'phone',   label: { es: 'Teléfono celular', en: 'Mobile number' },            type: 'tel',             required: false },
    { key: 'host',    label: { es: '¿A quién viene a ver?', en: 'Who are you here to see?' }, type: 'host-typeahead', required: true },
    { key: 'purpose', label: { es: 'Motivo de la visita', en: 'Reason for visit' },      type: 'select',          required: true,
      options: [
        { es: 'Reunión', en: 'Meeting' },
        { es: 'Entrega', en: 'Delivery' },
        { es: 'Entrevista', en: 'Interview' },
        { es: 'Proveedor', en: 'Vendor' },
        { es: 'Otro', en: 'Other' },
      ] },
  ],
};

// label, placeholder and options may be plain strings or { es, en } objects.
// The kiosk only ever sees plain strings in the site's active language.
function localizeField(field) {
  const { $comment, ...rest } = field;
  const out = { ...rest };
  if ('label' in out) out.label = pickLocalized(out.label);
  if ('placeholder' in out) out.placeholder = pickLocalized(out.placeholder);
  if (Array.isArray(out.options)) out.options = out.options.map(o => pickLocalized(o));
  return out;
}

// Public: kiosk (no auth) + admin UI both fetch this.
router.get('/', (_req, res) => {
  if (!existsSync(FORM_PATH)) return res.json({ fields: DEFAULT_FORM.fields.map(localizeField) });
  try {
    const raw = JSON.parse(readFileSync(FORM_PATH, 'utf8'));
    // Strip the $comment helper keys and resolve per-language labels.
    const fields = (raw.fields ?? []).map(localizeField);
    res.json({ fields });
  } catch (err) {
    res.status(500).json({ error: 'failed to read visitor form schema', details: err.message });
  }
});

export default router;
