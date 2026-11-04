// Real projections and inert views shared by the workspace handler fixtures.
import * as localMaterialSearch from '../../src/sublime/localMaterialSearch.js';
import * as clipperLibrary from '../../src/sublime/clipperLibrary.js';
import * as articleReaderModel from '../../src/sublime/articleReaderModel.js';
import * as articleFigures from '../../src/sublime/articleFigures.js';
import * as linkedNotes from '../../src/sublime/linkedNotes.js';
import * as saveOptions from '../../src/sublime/saveOptions.js';
import * as recallSession from '../../src/recallSession.js';
import * as recallModel from '../../src/recall/recallModel.js';

export const workspaceDependencies = {
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
