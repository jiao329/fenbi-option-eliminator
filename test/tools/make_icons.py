from PIL import Image, ImageDraw
import os

out = r"D:\code\temp\fenbi\fenbi-option-eliminator\icons"
os.makedirs(out, exist_ok=True)

def make(size):
    S = size * 8  # supersample
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = int(S * 0.22)
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=r, fill=(60, 124, 252, 255))
    # 圆环
    pad = S * 0.22
    lw = max(1, int(S * 0.085))
    d.ellipse([pad, pad, S - pad, S - pad], outline=(255, 255, 255, 255), width=lw)
    # 斜杠
    a = S * 0.20
    b = S * 0.80
    d.line([a, b, b, a], fill=(255, 255, 255, 255), width=lw)
    return img.resize((size, size), Image.LANCZOS)

for s in (16, 32, 48, 128):
    make(s).save(os.path.join(out, "icon%d.png" % s))
print("icons ok:", sorted(os.listdir(out)))
