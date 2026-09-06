"""Trusted, bounded signal-breakout compiler. System Python + pcbnew required.
No user code is loaded; inputs must match the server's fixed data-only schema.
"""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import zipfile
import math
import pcbnew as k

try:
    it = k.TRACKS().iterator()
    it.__class__.next = it.__class__.__next__
except Exception:
    pass


def generate(spec, out):
    if set(spec) != {'kind', 'nets', 'connector_spacing', 'trace_width'} or spec['kind'] != 'signal_breakout':
        raise ValueError('Unsupported PCB schema')
    names = spec['nets']
    if (not isinstance(names, list) or not 3 <= len(names) <= 8 or any(not isinstance(n, str) or not re.fullmatch(r'[A-Z][A-Z0-9_]{0,15}', n) for n in names)
            or len(set(names)) != len(names)):
        raise ValueError('Invalid PCB nets')
    for key, low, high in [('connector_spacing', 20, 38), ('trace_width', .25, .8)]:
        value = spec[key]
        if type(value) not in (float, int) or not math.isfinite(value) or not low <= value <= high:
            raise ValueError('Invalid PCB dimension')
    out.mkdir(parents=True, exist_ok=True)
    b = k.BOARD()
    def xy(x, y): return k.VECTOR2I(k.FromMM(x), k.FromMM(y))
    for a, z in [((100,100),(160,100)),((160,100),(160,140)),((160,140),(100,140)),((100,140),(100,100))]:
        line=k.PCB_SHAPE(); line.SetShape(k.SHAPE_T_SEGMENT); line.SetStart(xy(*a)); line.SetEnd(xy(*z)); line.SetLayer(k.Edge_Cuts); line.SetWidth(k.FromMM(.05)); b.Add(line)
    nets=[]
    for name in names:
        net=k.NETINFO_ITEM(b,name); b.Add(net); nets.append(net)
    left, right = 130-spec['connector_spacing']/2, 130+spec['connector_spacing']/2
    first_y = 120-(len(names)-1)*2.54/2
    for ref, x in [('J1',left),('J2',right)]:
        fp=k.FOOTPRINT(b); fp.SetReference(ref); fp.SetValue(f'Signal_1x{len(names):02}'); fp.SetPosition(xy(x,first_y)); fp.SetAttributes(k.FP_THROUGH_HOLE)
        fp.Reference().SetPosition(xy(x,first_y-3)); fp.Reference().SetTextSize(xy(1,1)); fp.Reference().SetTextThickness(k.FromMM(.15)); fp.Value().SetVisible(False)
        for i,net in enumerate(nets):
            pad=k.PAD(fp); pad.SetNumber(str(i+1)); pad.SetAttribute(k.PAD_ATTRIB_PTH); pad.SetShape(k.PAD_SHAPE_CIRCLE); pad.SetSize(xy(1.8,1.8)); pad.SetDrillSize(xy(1,1)); pad.SetLayerSet(k.LSET.AllCuMask()); pad.SetPosition(xy(x,first_y+i*2.54)); pad.SetNet(net); fp.Add(pad)
        b.Add(fp)
    for i,net in enumerate(nets):
        track=k.PCB_TRACK(b); track.SetStart(xy(left,first_y+i*2.54)); track.SetEnd(xy(right,first_y+i*2.54)); track.SetWidth(k.FromMM(spec['trace_width'])); track.SetLayer(k.F_Cu); track.SetNet(net); b.Add(track)
    for j,(x,y) in enumerate([(104,104),(156,104),(156,136),(104,136)]):
        fp=k.FOOTPRINT(b); fp.SetReference(f'H{j+1}'); fp.SetValue('Mount_M3'); fp.SetPosition(xy(x,y)); fp.Reference().SetVisible(False); fp.Value().SetVisible(False)
        pad=k.PAD(fp); pad.SetNumber(''); pad.SetAttribute(k.PAD_ATTRIB_NPTH); pad.SetShape(k.PAD_SHAPE_CIRCLE); pad.SetSize(xy(3.2,3.2)); pad.SetDrillSize(xy(3.2,3.2)); pad.SetLayerSet(k.LSET.AllCuMask()); pad.SetPosition(xy(x,y)); fp.Add(pad); b.Add(fp)
    label=k.PCB_TEXT(b); label.SetText('AUTOCADENT / SIGNAL BREAKOUT'); label.SetPosition(xy(130,135)); label.SetTextSize(xy(.8,.8)); label.SetTextThickness(k.FromMM(.12)); label.SetLayer(k.F_SilkS); b.Add(label)
    path=out/'custom-breakout.kicad_pcb'; k.SaveBoard(str(path),b)
    # Ensure a footprint library table exists so kicad-cli can resolve footprints.
    fp_lib_table=out/'fp-lib-table'
    if not fp_lib_table.exists():
        kicad_mod_dir=os.environ.get('KICAD_MOD_PATH','')
        if not kicad_mod_dir:
            for candidate in ['/usr/share/kicad/mod', '/usr/share/kicad/modules']:
                if os.path.isdir(candidate):
                    kicad_mod_dir=candidate; break
        if kicad_mod_dir:
            fp_lib_table.write_text(f'(fp_lib_table (version 7)(libs (lib (name KiCad)(type KiCad)(uri "{kicad_mod_dir}")(options "")(descr ""))))\n')
    gerber_dir=out/'gerbers'; gerber_dir.mkdir(parents=True,exist_ok=True)
    # Native pcbnew gerber/drill export — defensive across KiCad API versions.
    saved=k.LoadBoard(str(path))
    pc=k.PLOT_CONTROLLER(saved)
    # Configure plot params via the controller's own options.
    p=pc.GetPlotOptions()
    for attr,val in [('SetOutputDirectory',str(gerber_dir)),('SetFormat',k.PLOT_FORMAT_GERBER),('SetUseGerberAttributes',True),('SetPlotFrameRef',False)]:
        fn=getattr(p,attr,None)
        if fn: fn(val)
    for layer_id,layer_name in [(k.F_Cu,'F.Cu'),(k.F_SilkS,'F.SilkS'),(k.Edge_Cuts,'Edge.Cuts')]:
        pc.SetLayer(layer_id)
        pc.OpenPlotfile(layer_name,False,layer_name)
        pc.PlotLayer()
        pc.ClosePlot()
    del pc
    # Excellon drill — CreateDrillandMapFilesSet(outDir, genDrill, genMap)
    try:
        ew=k.EXCELLON_WRITER(saved)
        fmt_fn=getattr(ew,'SetFormat',None)
        if fmt_fn: fmt_fn(True)
        opt_fn=getattr(ew,'SetOptions',None)
        if opt_fn: opt_fn(False,False,k.VECTOR2I(0,0),False)
        for method_name in ['CreateDrillandMapFilesSet','CreateDrillAndMapFilesSet']:
            fn=getattr(ew,method_name,None)
            if fn:
                try:
                    fn(str(gerber_dir),True,False)
                    break
                except Exception:
                    continue
        del ew
    except Exception:
        pass
    # DRC, drill, and SVG via kicad-cli
    commands=[['pcb','drc','--format','json','-o',str(out/'drc.json'),str(path)],['pcb','export','drill','-o',str(gerber_dir)+'/',str(path)],['pcb','export','svg','--layers','F.Cu,F.SilkS,Edge.Cuts','--page-size-mode','2','-o',str(out/'board.svg'),str(path)]]
    for args in commands:
        r=subprocess.run(['kicad-cli',*args],capture_output=True,text=True,timeout=45)
        if r.returncode!=0:
            raise RuntimeError(f"kicad-cli {' '.join(args)} failed (exit {r.returncode}):\nstderr: {r.stderr}\nstdout: {r.stdout}")
    pads = [pad for fp in saved.GetFootprints() if fp.GetReference() in ['J1','J2'] for pad in fp.Pads()]
    tracks = list(saved.GetTracks())
    actual_nets = [{'name':name,'pins':sorted(f'{p.GetParentFootprint().GetReference()}.{p.GetNumber()}' for p in pads if p.GetNetname()==name)} for name in names]
    drc=json.loads((out/'drc.json').read_text())
    box=saved.GetBoardEdgesBoundingBox()
    outline=[round(k.ToMM(box.GetWidth()),4),round(k.ToMM(box.GetHeight()),4)]
    widths=[round(k.ToMM(t.GetWidth()),4) for t in tracks]
    checks=[
        dict(name='PCB DRC violations',measured=len(drc['violations']),requirement='0 (KiCad defaults)',passed=not drc['violations'],unit='violations',method='Native kicad-cli pcb drc'),
        dict(name='PCB unconnected items',measured=len(drc['unconnected_items']),requirement='0',passed=not drc['unconnected_items'],unit='items',method='Native kicad-cli pcb drc'),
        dict(name='PCB routed nets',measured=len(tracks),requirement=f'{len(names)} parallel 2-pin nets',passed=len(tracks)==len(names) and all(len(n['pins'])==2 for n in actual_nets) and {t.GetNetname() for t in tracks}==set(names),unit='nets',method='Reload saved native board pads and tracks'),
        dict(name='PCB trace width',measured=min(widths),requirement=f'{spec["trace_width"]} mm',passed=all(abs(w-spec['trace_width'])<1e-5 for w in widths),unit='mm',method='Reloaded native track widths'),
    ]
    report={'passed':all(c['passed'] for c in checks),'checks':checks,'outline_mm':outline,'nets':actual_nets,
            'kicad_version':k.Version(),'ignored_checks':drc.get('ignored_checks',[]),
            'scope':'Model-selected connector nets, spacing and track width in a trusted fixed-outline breakout. No MCU, motor driver, schematic/ERC, electrical function or fabrication certification.'}
    (out/'evaluation.json').write_text(json.dumps(report,indent=2)+'\n')
    (out/'nets.json').write_text(json.dumps({'nets':actual_nets},indent=2)+'\n')
    (out/'bom.csv').write_text(f'Reference,Value,Quantity,Notes\nJ1 J2,2.54mm 1x{len(names)} header,2,Signal breakout only\nH1 H2 H3 H4,M3 mounting hole,4,3.2mm unplated\n')
    (out/'pcb-spec.json').write_text(json.dumps(spec,indent=2)+'\n')
    with zipfile.ZipFile(out/'custom-breakout-board.zip','w',zipfile.ZIP_DEFLATED) as z:
        for file in sorted(out.rglob('*')):
            if file.is_file() and file.suffix!='.zip': z.write(file,file.relative_to(out))
    return report

if __name__=='__main__':
    parser=argparse.ArgumentParser(); parser.add_argument('--spec',required=True); parser.add_argument('--output',required=True)
    args=parser.parse_args()
    generate(json.loads(Path(args.spec).read_text()),Path(args.output).resolve())
