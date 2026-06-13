import {
  ZOUK_DYNAMICS,
  STEP_COLORS,
  STEP_NAMES,
  type BeatGridConfig,
} from '../beatgrid';
import { fmtTime } from '../format';

export type PickMode = 'none' | 'one' | 'two';

interface BeatGridPanelProps {
  cfg: BeatGridConfig;
  onChange: (cfg: BeatGridConfig) => void;
  pickMode: PickMode;
  setPickMode: (m: PickMode) => void;
  loopRegion?: { start: number; end: number } | null;
  onClearLoop?: () => void;
}

export function BeatGridPanel({ cfg, onChange, pickMode, setPickMode, loopRegion, onClearLoop }: BeatGridPanelProps) {
  const set = (patch: Partial<BeatGridConfig>) => onChange({ ...cfg, ...patch });

  const bpm = cfg.beatSet && cfg.beatDuration > 0 ? Math.round(60 / cfg.beatDuration) : 0;
  const twoTime = cfg.anchor + cfg.beatDuration;

  return (
    <div className="panel beatgrid">
      <div className="bg-group enable">
        <label className="chk">
          <input type="checkbox" checked={cfg.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
          Beat grid
        </label>
      </div>

      <label className="fld bg-group">
        Dynamic
        <select value={cfg.dynamicId} onChange={(e) => set({ dynamicId: e.target.value })}>
          {ZOUK_DYNAMICS.map((d) => (
            <option key={d.id} value={d.id}>{d.label}</option>
          ))}
        </select>
      </label>

      <div className="bg-group pick">
        <div className="pick-row">
          <button
            className={pickMode === 'one' ? 'btn tiny active' : 'btn tiny'}
            onClick={() => setPickMode(pickMode === 'one' ? 'none' : 'one')}
          >
            Set “1”
          </button>
          <span className="val">{cfg.anchorSet ? fmtTime(cfg.anchor) : '—'}</span>
        </div>
        <div className="pick-row">
          <button
            className={pickMode === 'two' ? 'btn tiny active' : 'btn tiny'}
            onClick={() => setPickMode(pickMode === 'two' ? 'none' : 'two')}
            disabled={!cfg.anchorSet}
            title={cfg.anchorSet ? '' : 'Set “1” first'}
          >
            Set “2”
          </button>
          <span className="val">{cfg.beatSet ? `${fmtTime(twoTime)} · ${bpm}bpm` : '—'}</span>
        </div>
        {pickMode !== 'none' && (
          <p className="hint">Click a graph at count “{pickMode === 'one' ? '1' : '2'}”.</p>
        )}
      </div>

      <div className="bg-group legend">
        {STEP_NAMES.map((name, i) => (
          <span key={i} className="legend-item">
            <span className="legend-dot" style={{ background: STEP_COLORS[i] }} />
            {name}
          </span>
        ))}
      </div>

      {onClearLoop && (
        <div className="bg-group">
          <button className="btn tiny loop-active" onClick={onClearLoop} disabled={!loopRegion}>
            Clear loop
          </button>
        </div>
      )}
    </div>
  );
}
