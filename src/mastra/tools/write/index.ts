import { safeWrap } from "../../../lib/safe-tool.js";

import { createActionItem as _createActionItem } from "./create-action-item.js";
import { updateActionItemStage as _updateActionItemStage } from "./update-action-item-stage.js";
import { dismissSignal as _dismissSignal } from "./dismiss-signal.js";
import { updateCompanyStage as _updateCompanyStage } from "./update-company-stage.js";
import { assignKeyRole as _assignKeyRole } from "./assign-key-role.js";
import { createEntityNote as _createEntityNote } from "./create-entity-note.js";
import { updateCompanyFields as _updateCompanyFields } from "./update-company-fields.js";
import { updateContactStage as _updateContactStage } from "./update-contact-stage.js";
import { updateContactFields as _updateContactFields } from "./update-contact-fields.js";
import { createContact as _createContact } from "./create-contact.js";
import { createCompany as _createCompany } from "./create-company.js";

export const createActionItem = safeWrap(_createActionItem);
export const updateActionItemStage = safeWrap(_updateActionItemStage);
export const dismissSignal = safeWrap(_dismissSignal);
export const updateCompanyStage = safeWrap(_updateCompanyStage);
export const assignKeyRole = safeWrap(_assignKeyRole);
export const createEntityNote = safeWrap(_createEntityNote);
export const updateCompanyFields = safeWrap(_updateCompanyFields);
export const updateContactStage = safeWrap(_updateContactStage);
export const updateContactFields = safeWrap(_updateContactFields);
export const createContact = safeWrap(_createContact);
export const createCompany = safeWrap(_createCompany);
