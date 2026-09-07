// Analytic effects: no particle history to leak across seeks or renderers.
const tint = (c, a) => `rgba(${c.join(',')},${Math.max(0, a)})`
const point = (a, b, c, t) => [(1-t)**2*a[0]+2*(1-t)*t*b[0]+t*t*c[0], (1-t)**2*a[1]+2*(1-t)*t*b[1]+t*t*c[1]]

export function drawEnergyBeam(ctx, start, end, color, progress, opacity, seed) {
  const dx = end[0]-start[0], dy = end[1]-start[1]
  const bend = Math.sin(seed * 2.399) * 0.22
  const control = [(start[0]+end[0])/2-dy*bend, (start[1]+end[1])/2+dx*bend]
  const head = Math.min(1, progress / 0.45)
  const fade = opacity * Math.min(1, (1-progress)/0.35)
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  // A tapering comet rather than a full, equally bright web of lines.
  for (let j=0; j<10; j++) {
    const t = Math.max(0, head-j*0.045), prev = Math.max(0, t-0.045)
    const p = point(start,control,end,t), q = point(start,control,end,prev)
    ctx.strokeStyle=tint(color,fade*(1-j/10)*0.55)
    ctx.lineWidth=1.2+(1-j/10)*2
    ctx.beginPath();ctx.moveTo(...q);ctx.lineTo(...p);ctx.stroke()
  }
  const [x,y]=point(start,control,end,head)
  const glow=ctx.createRadialGradient(x,y,0,x,y,12)
  glow.addColorStop(0,tint(color,fade*0.7));glow.addColorStop(1,tint(color,0))
  ctx.fillStyle=glow;ctx.fillRect(x-12,y-12,24,24)
  ctx.fillStyle=tint([235,255,255],fade)
  ctx.beginPath();ctx.arc(x,y,1.8,0,Math.PI*2);ctx.fill()
  ctx.restore()
}

export function drawCommitWave(ctx, x, y, radius, color, progress, opacity) {
  ctx.save();ctx.globalCompositeOperation='lighter'
  for(let i=0;i<2;i++) {
    const p=progress*1.35-i*0.22
    if(p<=0||p>=1)continue
    const r=8+radius*(1-(1-p)**3), a=Math.sin(Math.PI*p)*(1-p)*opacity
    const halo=ctx.createRadialGradient(x,y,r*0.7,x,y,r)
    halo.addColorStop(0,tint(color,0));halo.addColorStop(0.85,tint(color,a*0.11));halo.addColorStop(1,tint(color,0))
    ctx.fillStyle=halo;ctx.fillRect(x-r,y-r,r*2,r*2)
    ctx.strokeStyle=tint(color,a*0.65);ctx.lineWidth=1.8*(1-p)+0.3
    ctx.beginPath();ctx.ellipse(x,y,r,r*0.72,0,0,Math.PI*2);ctx.stroke()
    for(let j=0;j<12;j++) {
      const angle=j*Math.PI/6+0.25
      ctx.fillStyle=tint(color,a*0.7)
      ctx.beginPath();ctx.arc(x+Math.cos(angle)*r,y+Math.sin(angle)*r*0.72,1.2,0,Math.PI*2);ctx.fill()
    }
  }
  ctx.restore()
}
