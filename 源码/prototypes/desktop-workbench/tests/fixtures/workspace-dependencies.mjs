// Real projections and inert views shared by the workspace handler fixtures.
import { IDBFactory } from 'fake-indexeddb';
import * as workspaceBackup from '../../src/sublime/workspaceBackup.js';
import * as attachmentRegistry from '../../src/sublime/attachmentRegistry.js';
import * as attachmentStore from '../../src/sublime/attachmentStore.js';
import * as recallLibrary from '../../src/sublime/recallLibrary.js';
import * as starHomeView from '../../src/sublime/starHomeView.js';
import * as localMaterialSearch from '../../src/sublime/localMaterialSearch.js';
import * as clipperLibrary from '../../src/sublime/clipperLibrary.js';
import * as articleReaderModel from '../../src/sublime/articleReaderModel.js';
import * as articleFigures from '../../src/sublime/articleFigures.js';
import * as linkedNotes from '../../src/sublime/linkedNotes.js';
import * as saveOptions from '../../src/sublime/saveOptions.js';
import * as recallSession from '../../src/recallSession.js';
import * as recallModel from '../../src/recall/recallModel.js';

export const createFixtureAttachments = () => attachmentStore.createAttachmentStore({ indexedDB: new IDBFactory() });
export async function readFixtureBackup(input) {
 const files = createFixtureAttachments();
 try { const result = await workspaceBackup.importWorkspaceBackup(input, files); return await attachmentStore.restoreAttachmentData(result.state, files); }
 finally { await files.dispose(); }
}
export const workspaceDependencies = {
 './attachmentRegistry.js': attachmentRegistry,
 './attachmentStore.js': { ...attachmentStore, createAttachmentStore: createFixtureAttachments },
 './workspaceBackup.js': workspaceBackup,
 './recallLibrary.js': recallLibrary,
 './starHomeView.js': starHomeView,
 './StarHome.jsx': { default: () => null },
 './localMaterialSearch.js':localMaterialSearch,
 './clipperLibrary.js':clipperLibrary,
 './articleReaderModel.js':articleReaderModel,
 './articleFigures.js':articleFigures,
 '../recallSession.js':recallSession,
 '../recall/recallModel.js':recallModel,
 './CardContent.jsx':{default:()=>null,CollectionChips:()=>null},
 './ZoomableImage.jsx':{default:()=>null}, './CardReturnPreview.jsx':{default:()=>null},
 './SaveCardPanel.jsx':{default:()=>null}, './saveOptions.js':saveOptions,
 './linkedNotes.js':linkedNotes,
 './ArticleReader.jsx':{default:()=>null}, './PersonalRelated.jsx':{default:()=>null},
 './LibraryMeaningSearch.jsx':{default:()=>null, ImageResultSource:()=>null, useLibraryMeaningSearch:()=>({result:null})},
 './OriginalPositionStatus.jsx':{default:()=>null},
 './useOriginalPosition.js':{useOriginalPosition:()=>({state:null,open:()=>{}})},
 '../recall/RecallOnlyWorkbench.jsx':{default:()=>null},
};

export function currentWorkspaceModule(name) {
 if (Object.hasOwn(workspaceDependencies, name)) return workspaceDependencies[name];
 throw Error('Unexpected test import ' + name);
}
