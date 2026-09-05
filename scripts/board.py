"""KiCad native board generator; run with system Python that provides pcbnew.
Four parallel signal rails between two headers; not a motor controller.
"""
from pathlib import Path
import json
import subprocess
import zipfile
import pcbnew as k
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'web/artifacts/board'
OUT.mkdir(parents=True,exist_ok=True)
b=k.BOARD()
def xy(x,y): return k.VECTOR2I(k.FromMM(x),k.FromMM(y))
for a,z in [((100,100),(160,100)),((160,100),(160,140)),((160,140),(100,140)),((100,140),(100,100))]:
    line=k.PCB_SHAPE(); line.SetShape(k.SHAPE_T_SEGMENT); line.SetStart(xy(*a)); line.SetEnd(xy(*z)); line.SetLayer(k.Edge_Cuts); line.SetWidth(k.FromMM(.05)); b.Add(line)
nets=[]
for name in ['VCC_EXT','GND','SDA','SCL']:
    net=k.NETINFO_ITEM(b,name); b.Add(net); nets.append(net)
for ref,x in [('J1',115),('J2',145)]:
    fp=k.FOOTPRINT(b); fp.SetReference(ref); fp.SetValue('Signal_1x04'); fp.SetPosition(xy(x,115)); fp.SetAttributes(k.FP_THROUGH_HOLE)
    fp.Reference().SetPosition(xy(x,110)); fp.Reference().SetTextSize(xy(1,1)); fp.Reference().SetTextThickness(k.FromMM(.15))
    fp.Value().SetVisible(False)
    for i,net in enumerate(nets):
        pad=k.PAD(fp); pad.SetNumber(str(i+1)); pad.SetAttribute(k.PAD_ATTRIB_PTH); pad.SetShape(k.PAD_SHAPE_CIRCLE); pad.SetSize(xy(1.8,1.8)); pad.SetDrillSize(xy(1,1)); pad.SetLayerSet(k.LSET.AllCuMask()); pad.SetPosition(xy(x,115+i*2.54)); pad.SetNet(net); fp.Add(pad)
    b.Add(fp)
for i,net in enumerate(nets):
    t=k.PCB_TRACK(b); t.SetStart(xy(115,115+i*2.54)); t.SetEnd(xy(145,115+i*2.54)); t.SetWidth(k.FromMM(.4)); t.SetLayer(k.F_Cu); t.SetNet(net); b.Add(t)
for j,(x,y) in enumerate([(104,104),(156,104),(156,136),(104,136)]):
    fp=k.FOOTPRINT(b); fp.SetReference(f'H{j+1}'); fp.SetValue('Mount_M3'); fp.SetPosition(xy(x,y)); fp.Reference().SetVisible(False); fp.Value().SetVisible(False)
    pad=k.PAD(fp); pad.SetNumber(''); pad.SetAttribute(k.PAD_ATTRIB_NPTH); pad.SetShape(k.PAD_SHAPE_CIRCLE); pad.SetSize(xy(3.2,3.2)); pad.SetDrillSize(xy(3.2,3.2)); pad.SetLayerSet(k.LSET.AllCuMask()); pad.SetPosition(xy(x,y)); fp.Add(pad); b.Add(fp)
label=k.PCB_TEXT(b); label.SetText('AUTOCADENT / ROVE-1\nSIGNAL BREAKOUT'); label.SetPosition(xy(130,132)); label.SetTextSize(xy(1,1)); label.SetTextThickness(k.FromMM(.15)); label.SetLayer(k.F_SilkS); b.Add(label)
path=OUT/'rove-1.kicad_pcb'; k.SaveBoard(str(path),b)
(OUT/'bom.csv').write_text('Reference,Value,Quantity,Notes\nJ1 J2,2.54mm 1x4 header,2,External power and signals only\nH1 H2 H3 H4,M3 mounting hole,4,3.2mm unplated\n')
(OUT/'nets.json').write_text(json.dumps({'nets':[{'name':n,'pins':[f'J1.{i+1}',f'J2.{i+1}']} for i,n in enumerate(['VCC_EXT','GND','SDA','SCL'])]},indent=2))
commands=[['pcb','drc','--format','json','-o',str(OUT/'drc.json'),str(path)],['pcb','export','gerbers','-o',str(OUT/'gerbers')+'/',str(path)],['pcb','export','drill','-o',str(OUT/'gerbers')+'/',str(path)],['pcb','export','svg','--layers','F.Cu,F.SilkS,Edge.Cuts','--page-size-mode','2','--mode-single','-o',str(OUT/'board.svg'),str(path)]]
for args in commands: subprocess.run(['kicad-cli',*args],check=True,capture_output=True,text=True)
with zipfile.ZipFile(OUT/'rove-1-board.zip','w',zipfile.ZIP_DEFLATED) as z:
    for f in OUT.rglob('*'):
        if f.is_file() and f.suffix!='.zip': z.write(f,f.relative_to(OUT))
print(json.dumps({'board':str(path),'drc':json.loads((OUT/'drc.json').read_text())},indent=2))
