// Keep privileged original-file validation identical to the local workspace validator.
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
await build({stdin:{contents:"export {normalizeWorkspaceAttachment,MAX_ATTACHMENT_BYTES} from './prototypes/desktop-workbench/src/sublime/workspaceModel.js';",resolveDir:root,sourcefile:'attachment-validation-entry.mjs'},bundle:true,platform:'node',format:'cjs',target:'es2022',outfile:path.join(root,'desktop/attachment-validation.cjs')});
