// 读数条（L2 不透明面；数字唯一归属地）：SS_total / SS_between / SS_within / 恒等式残差
// 残差显示算法按《状态与事务规范》§7；超容差 = 套印色 + 原始残差 + 判定文字（绝不出现"显示 0.00 却被标红"）。

import type { DerivedObject, Result } from '../kernel/types';
import { identityThreshold, formatResidual } from '../kernel/compute';
import { identityId, ssBetweenId, ssTotalId, ssWithinId } from '../kernel/expressions';
import type { Store, StoreSnapshot } from '../state/store';
import { fmt } from './scale';
import type { RepRegistry } from './reps';

function statusSub(obj: DerivedObject | undefined): string {
  if (obj === undefined || obj.status === 'valid') return '';
  const msg = obj.reason?.message ?? obj.status;
  return msg.length > 46 ? `${msg.slice(0, 45)}…` : msg;
}

export function mountReadings(root: HTMLElement, store: Store, reps: RepRegistry): { render(snap: StoreSnapshot): void } {
  void store;
  let lastRevision = -1;

  function render(snap: StoreSnapshot): void {
    const { effective, source, result } = snap;
    const pulse = source.dataset.revision !== lastRevision;
    lastRevision = source.dataset.revision;
    reps.clearView('readings');

    const sst = effective.objects.get(ssTotalId);
    const ssb = effective.objects.get(ssBetweenId);
    const ssw = effective.objects.get(ssWithinId);
    const con = effective.objects.get(identityId);
    const changed = new Set(pulse ? result.changedObjectIds : []);

    const sstV = sst?.status === 'valid' ? sst.value : undefined;
    const ssbV = ssb?.status === 'valid' ? ssb.value : undefined;
    const sswV = ssw?.status === 'valid' ? ssw.value : undefined;

    const row = (id: string, label: string, obj: DerivedObject | undefined): string => {
      const valid = obj?.status === 'valid' && obj.value !== undefined;
      const val = valid ? fmt(obj.value, 2) : '—';
      const sub = statusSub(obj);
      return `<div class="row" data-key="row:${id}">
        <span class="lab">${label}</span>
        <span style="text-align:right">
          <span class="val${valid ? '' : ' dim'}${changed.has(id) ? ' just-changed-val' : ''}">${val}</span>
          ${sub !== '' ? `<span class="sub">${sub}</span>` : ''}
        </span>
      </div>`;
    };

    reps.register(ssTotalId, { viewId: 'readings', kind: 'reading-row', elementKey: 'row:sst' });
    reps.register(ssBetweenId, { viewId: 'readings', kind: 'reading-row', elementKey: 'row:ssb' });
    reps.register(ssWithinId, { viewId: 'readings', kind: 'reading-row', elementKey: 'row:ssw' });
    reps.register(identityId, { viewId: 'readings', kind: 'reading-row', elementKey: 'row:identity' });

    const conValid = con?.status === 'valid';
    const conInvalid = con?.status === 'invalid';
    const residualShown = formatResidual(con?.status ?? 'undefined', con?.residual);
    let residualSub = '';
    if (conInvalid && sstV !== undefined && ssbV !== undefined && sswV !== undefined) {
      const tol = identityThreshold(sswV, ssbV, sstV);
      residualSub = `残差 ${(con?.residual ?? 0).toExponential(3)} > 容差 ${tol.toExponential(3)}`;
    } else if (conValid) {
      residualSub = '容差内（非精确为零；原始值见检查器）';
    } else {
      residualSub = statusSub(con);
    }

    const barTotal = (ssbV ?? 0) + (sswV ?? 0);
    const showBar = ssbV !== undefined && sswV !== undefined && barTotal > 0;
    const betweenPct = showBar ? (ssbV / barTotal) * 100 : 0;

    root.innerHTML = `
      <div class="panel readings">
        ${row(ssTotalId, 'SS_total', sst)}
        ${row(ssBetweenId, 'SS_between', ssb)}
        ${row(ssWithinId, 'SS_within', ssw)}
        <div class="row residual-flag${conInvalid ? ' conflict' : ''}" data-key="row:identity">
          <span class="lab">恒等式残差</span>
          <span style="text-align:right">
            <span class="val${conValid ? '' : ' dim'}${changed.has(identityId) ? ' just-changed-val' : ''}">${residualShown}</span>
            <span class="sub">SS_T − (SS_B + SS_W)；${residualSub}</span>
          </span>
        </div>
        <div class="bar">
          ${
            showBar
              ? `<div class="bar-track" role="img" aria-label="SS_T 的构成比例：组间 ${betweenPct.toFixed(0)}%，组内 ${(100 - betweenPct).toFixed(0)}%">
                   <div class="bar-seg between" style="width:${betweenPct.toFixed(2)}%"></div>
                   <div class="bar-seg within" style="width:${(100 - betweenPct).toFixed(2)}%"></div>
                 </div>
                 <div class="bar-lab"><span>■ SS_B（阴影线为 SS_W）</span><span>条仅示比例；数值见上方读数</span></div>`
              : `<div class="bar-lab"><span>—</span><span>平方和未就绪，暂不显示比例</span></div>`
          }
        </div>
      </div>`;
  }

  return { render };
}

/** 供外部读取（测试/诊断）：当前结果中的四个读数对象 */
export function readingObjects(result: Result): (DerivedObject | undefined)[] {
  return [result.objects.get(ssTotalId), result.objects.get(ssBetweenId), result.objects.get(ssWithinId), result.objects.get(identityId)];
}
