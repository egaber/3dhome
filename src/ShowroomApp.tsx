import { Component, useCallback, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Camera, Check, ChevronDown, Copy, Download, Footprints, Grid2X2, House, Layers, Moon, Palette, RotateCcw, Sun, Sunset, TreePine, Upload } from 'lucide-react';
import { Viewer, type CameraBookmark } from './App';
import { WalkMinimap } from './components/WalkMinimap';
import { ShowroomDialog } from './components/ShowroomDialog';
import { FloorEditor2D } from './components/FloorEditor2D';
import { MaterialLibrary } from './components/MaterialLibrary';
import { QuickObjectEditor, type PickedObject } from './components/QuickObjectEditor';
import { ActionHistory, HistoryControls } from './components/ActionHistory';
import { PlanImportDialog } from './components/PlanImportDialog';
import { useActionHistory } from './lib/useActionHistory';
import { historyShortcut, type StateUpdate } from './lib/actionHistory';
import { isEditableTarget } from './lib/walkNavigation';
import { defaultState, resolvedRooms, buildingArea } from './model/plans';
import { FLOOR_NAMES, type SimulationState, type UnitId } from './model/types';
import { parseProject, PROJECT_STORAGE_KEY, serializeProject } from './lib/project';
import { activateDesign, createDesignLibrary, DESIGN_LIBRARY_KEY, designName, duplicateDesign, mergeDesignLibrary, parseDesignLibrary, removeDesign, storeDesignLibrary, updateDesign, type DesignLibrary } from './lib/designLibrary';
import { applyShowroomLook, ROOM_FLOORS, showroomProject, type VisitorPosition } from './lib/showroom';
import { resolveTourRoom } from './lib/roomTour';
import { duplexCamera } from './lib/duplexPresentation';
import { ProjectPersistence } from './lib/projectPersistence';
import { installOctoberAlternative } from './lib/octoberAlternative';
import { OCTOBER_PLAN_ID, OCTOBER_PLAN_NAME, OCTOBER_SOURCE } from './model/octoberGroundPlan';
import { LandscapeEditor } from './components/LandscapeEditor';
import { gardenViewpoint } from './lib/gardenNavigation';
import { applyCadCommand } from './model/cad';
import './showroom.css';

function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function initialLibrary(): { library: DesignLibrary; expectedRevision: number | null; error: string } {
  try {
    const requested = new URLSearchParams(location.search).get('plan') === 'october-2026';
    const choose = (library: DesignLibrary) => requested ? installOctoberAlternative(library, new Date().toISOString()) : library;
    const saved = localStorage.getItem(DESIGN_LIBRARY_KEY);
    if (saved !== null) {
      const library = parseDesignLibrary(saved);
      return { library: choose(library), expectedRevision: library.revision, error: '' };
    }
    const old = localStorage.getItem(PROJECT_STORAGE_KEY);
    const source = old === null ? { ...defaultState(), date: '2026-09-21', minutes: 660 } : parseProject(old);
    return { library: choose(createDesignLibrary(showroomProject(source), 'original', new Date().toISOString())), expectedRevision: null, error: '' };
  } catch (cause) {
    return { library: createDesignLibrary(showroomProject(defaultState()), 'recovery', new Date().toISOString()), expectedRevision: null,
      error: `לא ניתן לטעון את השמירה. הנתונים הקיימים לא שונו. ${cause instanceof Error ? cause.message : 'האחסון אינו זמין.'}` };
  }
}

class SceneBoundary extends Component<{ children: ReactNode }, { error: string }> {
  state = { error: '' };
  static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('Showroom rendering failed', error, info.componentStack); }
  render() {
    return this.state.error ? <div className="showroom-render-error" role="alert"><h2>לא ניתן להפעיל את תצוגת התלת־ממד</h2>
      <p>בדקו ש־WebGL והאצת חומרה מופעלים בדפדפן. החלופות וכלי התכנון עדיין זמינים.</p><p>{this.state.error}</p></div> : this.props.children;
  }
}

export default function ShowroomApp() {
  const initial = useMemo(initialLibrary, []);
  const [library, setLibrary] = useState(initial.library), libraryRef = useRef(library);
  const revision = useRef(initial.expectedRevision), [storageError, setStorageError] = useState(initial.error);
  const [lastSaved, setLastSaved] = useState('');
  const persist = useCallback((next: DesignLibrary) => {
    try {
      if (initial.error) throw new Error(initial.error);
      const saved = storeDesignLibrary(localStorage, next, revision.current);
      revision.current = saved.revision; libraryRef.current = saved; setLibrary(saved);
      setStorageError(''); setLastSaved(new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }));
      return true;
    } catch (cause) {
      setStorageError(`השמירה לא הושלמה. הורידו גיבוי לפני סגירה. ${cause instanceof Error ? cause.message : 'האחסון מלא או אינו זמין.'}`);
      return false;
    }
  }, [initial.error]);
  const save = useCallback((state: SimulationState) => persist(updateDesign(libraryRef.current, state, new Date().toISOString())), [persist]);
  const active = library.options.find(option => option.id === library.activeId)!;
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (storageError) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [storageError]);
  return <ShowroomWorkspace initial={active.project} library={library} storageError={storageError} lastSaved={lastSaved}
    onSave={save}
    onCopy={(state, name) => persist(duplicateDesign(updateDesign(libraryRef.current, state, new Date().toISOString()), state, name, `design-${crypto.randomUUID()}`, new Date().toISOString()))}
    onSwitch={(state, id) => persist(activateDesign(updateDesign(libraryRef.current, state, new Date().toISOString()), id))}
    onRename={name => persist({ ...libraryRef.current, options: libraryRef.current.options.map(option => option.id === libraryRef.current.activeId ? { ...option, name: designName(name) } : option) })}
    onRemove={id => persist(removeDesign(libraryRef.current, id))}
    onOctober={state => persist(installOctoberAlternative(updateDesign(libraryRef.current, state, new Date().toISOString()), new Date().toISOString()))}
    onImportLibrary={incoming => persist(mergeDesignLibrary(libraryRef.current, incoming, incoming.options.map(() => `import-${crypto.randomUUID()}`), new Date().toISOString()))}
    onImport={(state, name) => persist(duplicateDesign(libraryRef.current, showroomProject(state), name, `import-${crypto.randomUUID()}`, new Date().toISOString()))} />;
}

function ShowroomWorkspace({ initial, library, storageError, lastSaved, onSave, onCopy, onSwitch, onRename, onRemove, onImport, onImportLibrary, onOctober }: {
  initial: SimulationState; library: DesignLibrary; storageError: string; lastSaved: string;
  onSave: (state: SimulationState) => boolean; onCopy: (state: SimulationState, name: string) => boolean;
  onSwitch: (state: SimulationState, id: string) => boolean; onRename: (name: string) => boolean;
  onRemove: (id: string) => boolean; onImport: (state: SimulationState, name: string) => boolean;
  onImportLibrary: (library: DesignLibrary) => boolean;
  onOctober: (state: SimulationState) => boolean;
}) {
  const history = useActionHistory(() => initial), state = history.state;
  const [projectId, setProjectId] = useState(library.activeId);
  const [unit, setUnit] = useState<UnitId>(state.buildings.north.enabled ? 'north' : 'south');
  const [roomId, setRoomId] = useState(() => resolveTourRoom(state, unit, '')?.id ?? '');
  const room = resolveTourRoom(state, unit, roomId);
  const [panel, setPanel] = useState<'designs' | 'settings' | 'rooms' | 'import' | 'landscape' | null>(null);
  const [editor, setEditor] = useState(false), [materials, setMaterials] = useState(false), [historyOpen, setHistoryOpen] = useState(false);
  const [picked, setPicked] = useState<PickedObject | null>(null), [measuring, setMeasuring] = useState(false);
  const [cameraRestore, setCameraRestore] = useState<CameraBookmark | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null), importInput = useRef<HTMLInputElement>(null);
  const [visitor, setVisitor] = useState<VisitorPosition | null>(null), [walkStatus, setWalkStatus] = useState('');
  const [entryRevision, setEntryRevision] = useState(0), [walk, setWalk] = useState({ forward: 0, strafe: 0 });
  const [error, setError] = useState(''), [message, setMessage] = useState('');
  const current = library.options.find(option => option.id === library.activeId)!;
  const [name, setName] = useState(`${current.name} · חלופה`);
  const modelRef = useRef(state); modelRef.current = state;
  const suspended = !!panel || editor || materials || historyOpen || !!picked;
  const stop = useCallback(() => setWalk(previous => previous.forward || previous.strafe ? { forward: 0, strafe: 0 } : previous), []);
  useEffect(() => {
    if (projectId === library.activeId) return;
    history.reset(initial); setProjectId(library.activeId);
    const selectedUnit = initial.buildings.north.enabled ? 'north' : 'south';
    setUnit(selectedUnit); setRoomId(resolveTourRoom(initial, selectedUnit, '')?.id ?? '');
    setPanel(null); setPicked(null); setVisitor(null); setCameraRestore(null); setEntryRevision(value => value + 1);
    setName(`${current.name} · חלופה`); setError('');
  }, [projectId, library.activeId, initial, current.name, history.reset]);
  useEffect(() => { if (projectId === library.activeId) onSave(state); }, [state, onSave, projectId, library.activeId]);
  useEffect(() => {
    if (library.activeId === OCTOBER_PLAN_ID && new URLSearchParams(location.search).get('plan') === 'october-2026' && !storageError) {
      const url = new URL(location.href); url.searchParams.delete('plan'); window.history.replaceState(null, '', url);
    }
  }, [library.activeId, storageError]);
  useEffect(() => { stop(); }, [suspended, state.view.mode, stop]);
  useEffect(() => {
    const hidden = () => { if (document.hidden) stop(); };
    window.addEventListener('blur', stop); document.addEventListener('visibilitychange', hidden);
    return () => { window.removeEventListener('blur', stop); document.removeEventListener('visibilitychange', hidden); };
  }, [stop]);
  const change = useCallback((update: StateUpdate, label?: string) => {
    try {
      const next = typeof update === 'function' ? update(modelRef.current) : update;
      serializeProject(next); history.change(next, label); setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'השינוי לא הוחל.'); }
  }, [history.change]);
  const historyControls = { canUndo: history.canUndo, canRedo: history.canRedo,
    onUndo: () => { history.undo(); setPicked(null); }, onRedo: () => { history.redo(); setPicked(null); },
    onShowHistory: () => setHistoryOpen(true) };
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (panel && panel !== 'landscape' || materials) return;
      const action = historyShortcut(event, isEditableTarget(event.target));
      if (!action) return;
      event.preventDefault(); if (action === 'undo') history.undo(); else history.redo();
    };
    window.addEventListener('keydown', keyboard); return () => window.removeEventListener('keydown', keyboard);
  }, [panel, materials, history.undo, history.redo]);
  const visit = (id: string) => {
    const selected = resolvedRooms(state).find(item => item.id === id);
    if (!selected) { setError('החדר אינו זמין בתוכנית הנוכחית.'); return; }
    setUnit(selected.unit); setRoomId(id); setEntryRevision(value => value + 1); setCameraRestore(null);
    change({ ...state, view: { ...state.view, mode: 'walk', cutaway: 'none', isolateFloor: 'none' } }, 'כניסה לחדר');
    setPanel(null); setPicked(null);
  };
  const visitGarden = (destination = unit) => {
    if (state.design.importedPlan) { setError('לתוכנית מיובאת עדיין לא הוגדר מגרש. אפשר לסייר בתוך התוכנית.'); return; }
    setUnit(destination); setEntryRevision(value => value + 1); setPicked(null); setPanel(null); setMessage('');
    change({ ...state, view: { ...state.view, mode: 'walk', cutaway: 'none', isolateFloor: 'none' } }, 'סיור בגינה');
    setCameraRestore(gardenViewpoint(state, destination));
  };
  const toggleOpening = useCallback((id: string, open: boolean) => {
    stop();
    change(current => applyCadCommand(current, { type: 'opening', id, patch: { open, shutter: false } }), open ? 'פתיחת דלת או ויטרינה' : 'סגירת דלת או ויטרינה');
  }, [change, stop]);
  const pose = useCallback((next: VisitorPosition) => setVisitor(previous => previous && previous.unit === next.unit && previous.floor === next.floor && previous.outside === next.outside
    && Math.abs(previous.point[0] - next.point[0]) < .005 && Math.abs(previous.point[1] - next.point[1]) < .005 && Math.abs(previous.heading - next.heading) < .2 ? previous : next), []);
  const cameraChanged = useCallback(() => undefined, []);
  const sunlight = (minutes: number) => change({ ...state, date: '2026-09-21', minutes }, 'תאורת סיור');
  const exportAll = () => {
    try { download('dori-home-designs.json', JSON.stringify(updateDesign(library, state, new Date().toISOString()))); setMessage('גיבוי החלופות הורד. שמרו אותו מחוץ לדפדפן.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'הייצוא נכשל.'); }
  };
  const capture = () => {
    const element = canvas.current;
    if (!element) { setError('התצוגה עדיין אינה מוכנה.'); return; }
    element.toBlob(blob => {
      if (!blob) { setError('לא ניתן לצלם את התצוגה.'); return; }
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = 'dori-home-view.png'; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage('תמונת הסיור הורדה.');
    }, 'image/png');
  };
  const attempt = (operation: () => boolean) => {
    try { if (operation()) { setPanel(null); setError(''); } }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'הפעולה לא בוצעה.'); }
  };
  const floorLabel = visitor?.outside ? 'גינה וחוץ' : visitor?.floor === 'roof' ? 'קומת גג' : FLOOR_NAMES[visitor?.floor ?? room?.floor ?? 'ground'];
  const displayedUnit = visitor?.unit ?? unit;
  return <ProjectPersistence.Provider value={onSave}><main className="showroom-app" dir="rtl">
    <header className="showroom-header">
      <a className="showroom-brand" href="#v2" aria-label="דורי 50 · חוויית הבית"><span><House size={23} /></span><div><strong>דורי 50<span className="showroom-version">V2</span></strong><small>לא רק לראות. להרגיש בבית.</small></div></a>
      <nav aria-label="כלי חוויית הבית">
        <button className={state.view.mode === 'walk' ? 'is-active' : ''} onClick={() => room && visit(room.id)}><Footprints size={17} /><span>סיור בבית</span></button>
        <button onClick={() => setEditor(true)}><Grid2X2 size={17} /><span>עריכת 2D</span></button>
        <button onClick={() => setPanel('designs')}><Layers size={17} /><span>חלופות</span><b>{library.options.length}</b></button>
        <button onClick={() => setMaterials(true)}><Palette size={17} /><span>חומרים</span></button>
        <button onClick={() => setPanel('landscape')}><TreePine size={17} /><span>צמחייה</span></button>
      </nav>
      <div className="showroom-save" role="status">{storageError ? <span>לא נשמר</span> : <><Check size={14} /><span>{lastSaved ? `נשמר · ${lastSaved}` : 'מכין שמירה…'}</span></>}</div>
    </header>
    <section className="showroom-stage" aria-label="סיור חי בבית">
      <SceneBoundary><Viewer state={state} selectedRoom={room?.id ?? roomId} selectedUnit={unit} onUnit={setUnit}
        onSelectOpening={() => undefined} onPickObject={setPicked} picked={picked} restoredCamera={cameraRestore}
        onCameraChange={cameraChanged} canvasRef={canvas} walkVector={walk} keyboardEnabled={!suspended} measuring={measuring}
        onMeasuring={setMeasuring} measurementRevision={history.index} onWalkStatus={setWalkStatus} roomEntryRevision={entryRevision}
        showroom deferSceneUpdates={editor || materials || historyOpen || !!panel} onVisitorChange={pose} onOpeningChange={toggleOpening} /></SceneBoundary>
      <WalkMinimap state={state} visitor={visitor} />
      <div className="showroom-location">
        <small>THE DORI RESIDENCE</small><h1>{visitor?.outside ? 'הגינה' : displayedUnit !== unit ? 'בתוך הבית' : room?.name ?? 'הבית שלכם'}</h1>
        <button onClick={() => setPanel('rooms')}><span>{displayedUnit === 'north' ? 'הבית הצפוני' : 'הבית הדרומי'} · {floorLabel}</span><ChevronDown size={15} /></button>
        <span className="showroom-option-name">{current.name}</span>
      </div>
      <div className="showroom-tools" role="group" aria-label="תצוגה ותאורה">
        <button title="סיור בגינה" aria-label="סיור בגינה" onClick={() => visitGarden()}><TreePine size={18} /></button>
        <button title="מבט חוץ" aria-label="מבט חוץ" onClick={() => {
          const view = duplexCamera(state, 'exterior', (canvas.current?.clientWidth ?? 1440) / (canvas.current?.clientHeight ?? 900));
          if (view) { setCameraRestore(view); change({ ...state, view: { ...state.view, mode: 'orbit', cutaway: 'none', isolateFloor: 'none' } }); }
        }}><House size={18} /></button>
        <button title="אור יום" aria-label="אור יום" onClick={() => sunlight(660)}><Sun size={18} /></button>
        <button title="שעת זהב" aria-label="שעת זהב" onClick={() => sunlight(1035)}><Sunset size={18} /></button>
        <button title="ערב" aria-label="ערב" onClick={() => sunlight(1170)}><Moon size={18} /></button>
        <button title="צילום הסיור" aria-label="צילום הסיור" onClick={capture}><Camera size={18} /></button>
        <button title="אפשרויות סיור" aria-label="אפשרויות סיור" onClick={() => setPanel('settings')}><Layers size={18} /></button>
      </div>
      {state.view.mode === 'walk' && !suspended && !measuring && <div className="showroom-walk-controls" role="group" aria-label="בקרי הליכה">
        {([{ name: 'שמאלה', icon: ArrowLeft, forward: 0, strafe: -1 }, { name: 'קדימה', icon: ArrowUp, forward: 1, strafe: 0 },
          { name: 'אחורה', icon: ArrowDown, forward: -1, strafe: 0 }, { name: 'ימינה', icon: ArrowRight, forward: 0, strafe: 1 }]).map(button =>
          <button key={button.name} aria-label={button.name} onPointerDown={event => {
            if (event.button !== 0) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
            setWalk({ forward: button.forward, strafe: button.strafe });
          }} onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={stop}
            onKeyDown={event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); setWalk({ forward: button.forward, strafe: button.strafe }); } }}
            onKeyUp={stop} onBlur={stop}><button.icon size={20} /></button>)}
      </div>}
      {picked && <QuickObjectEditor picked={picked} state={state} onChange={change} onClose={() => setPicked(null)} onSelect={setPicked} />}
    </section>
    <footer className="showroom-footer"><span className="showroom-hint">גרירה למבט · חצים / WASD להליכה · קליק או F לפתיחת דלת קרובה</span>
      <span className="showroom-live" role="status">{message || walkStatus || 'תצוגה חיה · חומרים בקנה מידה אמיתי'}</span>
      <button onClick={() => setPanel('import')}><Upload size={15} /> ייבוא תוכנית</button></footer>
    {(storageError || error) && !panel && <div className="showroom-alert" role="alert"><span>{storageError || error}</span><button onClick={exportAll}>הורדת גיבוי</button>{error && <button onClick={() => setError('')}>סגירה</button>}</div>}
    {panel === 'rooms' && <ShowroomDialog title="בחרו לאן ללכת" error={error || storageError} onClose={() => setPanel(null)}>
      <div className="showroom-unit-picker">{(['north', 'south'] as const).map(id => <button key={id} disabled={!state.buildings[id].enabled}
        className={unit === id ? 'is-active' : ''} onClick={() => setUnit(id)}>{id === 'north' ? 'הבית הצפוני' : 'הבית הדרומי'}</button>)}</div>
      {ROOM_FLOORS.map(floor => <section className="showroom-room-list" key={floor}><h3>{FLOOR_NAMES[floor]}</h3>
        {resolvedRooms(state).filter(item => item.unit === unit && item.floor === floor).map(item => <button key={item.id} onClick={() => visit(item.id)}>
          <House size={18} /><span>{item.name}</span><ArrowLeft size={15} /></button>)}</section>)}
      {!state.design.importedPlan && <button className="showroom-primary" onClick={() => visitGarden()}><TreePine size={18} /> כניסה לסיור בגינה</button>}
    </ShowroomDialog>}
    {panel === 'designs' && <ShowroomDialog title="החלופות שלי" error={error || storageError} onClose={() => setPanel(null)}>
      <p>כל חלופה נשמרת בנפרד בדפדפן זה. שינויים בחלופה אחת לא משנים את האחרות.</p>
      <section className="october-plan-card"><h3>{OCTOBER_PLAN_NAME}</h3><p>חלופה לפי קווי ה־PDF והמידות המצורפות. קומות עליונות וגבהים מהמודל הקיים, לא מהקובץ.</p>
        <button onClick={() => attempt(() => onOctober(state))}>פתיחת חלופת 8 באוקטובר</button>
        <details><summary>הצגת תוכנית המקור</summary><img src={OCTOBER_SOURCE.image} alt="קומת קרקע מתוך תוכנית 8 באוקטובר 2026" /></details>
      </section>
      <form className="showroom-save-as" onSubmit={event => { event.preventDefault(); attempt(() => onCopy(state, name)); }}>
        <label>שם החלופה<input value={name} maxLength={80} onChange={event => setName(event.target.value)} placeholder="לדוגמה: עץ טבעי ואבן בהירה" /></label>
        <button className="showroom-primary" type="submit"><Copy size={16} /> שמירה כחלופה חדשה</button>
        <button type="button" onClick={() => attempt(() => onRename(name))}>שינוי שם החלופה הנוכחית</button>
      </form>
      <div className="showroom-designs">{library.options.map(option => <article key={option.id} className={option.id === current.id ? 'is-active' : ''}>
        <House size={24} /><div><strong>{option.name}</strong><small>עודכן {new Date(option.updated).toLocaleString('he-IL')}</small></div>
        {option.id === current.id ? <span>פעילה</span> : <><button onClick={() => attempt(() => onSwitch(state, option.id))}>פתיחה</button>
          <button onClick={() => { if (window.confirm(`למחוק את "${option.name}"? הפעולה אינה ניתנת לביטול.`)) attempt(() => onRemove(option.id)); }}>מחיקה</button></>}
      </article>)}</div>
      <div className="showroom-dialog-actions"><button onClick={exportAll}><Download size={16} /> גיבוי כל החלופות</button><button onClick={() => importInput.current?.click()}><Upload size={16} /> פתיחת קובץ שמור</button></div>
      <p className="showroom-note">ניקוי נתוני הדפדפן מוחק שמירות מקומיות. הגיבוי כולל תוכניות ותמונות מותאמות; הנכסים המובנים נטענים מהיישום.</p>
    </ShowroomDialog>}
    {panel === 'settings' && <ShowroomDialog title="אפשרויות סיור" error={error || storageError} onClose={() => setPanel(null)}>
      <p>שני בתים, כ־{Math.round(buildingArea(unit, state))} מ״ר במפלס הראשי. התוכניות הן מודל תכנון, לא אישור בנייה.</p>
      <h3>בהשראת התמונות</h3><div className="showroom-dialog-actions">
        <button onClick={() => change(applyShowroomLook(state, 'natural'), 'עיצוב עץ וטקסטיל טבעי')}>עץ וטקסטיל טבעי</button>
        <button onClick={() => change(applyShowroomLook(state, 'stone'), 'עיצוב אבן בהירה')}>אבן בהירה</button>
      </div><p className="showroom-note">החלת סגנון מחליפה את גימור הרצפות ואת מודלי הספות. ניתן לבטל דרך היסטוריית הפעולות.</p>
      <label>איכות תצוגה<select value={state.view.quality} onChange={event => change({ ...state, view: { ...state.view, quality: event.target.value === 'high' ? 'high' : 'standard' } })}>
        <option value="high">איכות גבוהה · צללי מגע</option><option value="standard">ביצועים · ללא צללי מגע</option></select></label>
      <label>גובה העיניים (מטרים)<input type="number" min="1" max="2.1" step=".05" value={state.view.eyeHeight}
        onChange={event => { const value = event.currentTarget.valueAsNumber; if (Number.isFinite(value)) change({ ...state, view: { ...state.view, eyeHeight: value } }); }} /></label>
      <HistoryControls {...historyControls} />
      <button onClick={() => room && visit(room.id)}><RotateCcw size={16} /> חזרה לכניסה לחדר</button>
      <a className="showroom-classic-link" href="#classic">פתיחת הסטודיו המקורי · נתונים נפרדים</a>
      <p className="showroom-note">רינדור PBR בזמן אמת, לא צילום ולא הבטחה לשוויון למנוע משחק AAA. ההשראה: עץ טבעי, אבן, טקסטיל, מסגרות כהות ואור רך. חומרים וריהוט: Poly Haven, Khronos, Kenney; רישיונות בספריית החומרים.</p>
    </ShowroomDialog>}
    {panel === 'import' && <PlanImportDialog state={state} persistenceError={error || storageError} onClose={() => setPanel(null)} onApply={(next, title) => attempt(() => onImport(next, title))} />}
    {panel === 'landscape' && <LandscapeEditor state={state} selectedUnit={unit} onChange={change} historyControls={historyControls}
      persistenceError={error || storageError} onClose={() => setPanel(null)} />}
    <input ref={importInput} hidden type="file" accept=".json,application/json" onChange={async event => {
      const input = event.currentTarget, file = input.files?.[0]; if (!file) return;
      const before = modelRef.current;
      try {
        if (file.size > 32_000_000) throw new Error('הקובץ גדול מדי (עד 32 MB).');
        const content = await file.text();
        const raw: unknown = JSON.parse(content);
        let project: SimulationState;
        if (raw && typeof raw === 'object' && 'format' in raw && raw.format === 'dori-home-designs') {
          const imported = parseDesignLibrary(content);
          if (modelRef.current !== before) throw new Error('המודל השתנה בזמן הייבוא. בחרו את הקובץ מחדש.');
          attempt(() => onImportLibrary(imported)); return;
        } else if (raw && typeof raw === 'object' && 'project' in raw) project = parseProject(JSON.stringify(raw.project));
        else project = parseProject(content);
        if (modelRef.current !== before) throw new Error('המודל השתנה בזמן הייבוא. בחרו את הקובץ מחדש.');
        attempt(() => onImport(project, file.name.replace(/\.json$/i, '').slice(0, 80)));
      } catch (cause) { setError(cause instanceof Error ? cause.message : 'הייבוא נכשל.'); }
      finally { input.value = ''; }
    }} />
    {editor && <FloorEditor2D state={state} onChange={change} onClose={() => setEditor(false)} historyControls={historyControls} onBeginEdit={history.begin} onEndEdit={history.end} />}
    {materials && <MaterialLibrary state={state} selectedUnit={unit} onChange={change} onPick={setPicked} onClose={() => setMaterials(false)} onEnable={() => setMaterials(false)} onBackup={exportAll} />}
    {historyOpen && <ActionHistory {...historyControls} entries={history.entries} index={history.index} onJump={history.jump} onClose={() => setHistoryOpen(false)} />}
  </main></ProjectPersistence.Provider>;
}
