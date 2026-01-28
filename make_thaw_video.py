import os
import glob
from PIL import Image

# 設定
INPUT_DIR = "./result_thaw"
OUTPUT_FILE = "thawed_time.gif"
DURATION = 200  # フレーム切り替え速度 (ミリ秒)

def main():
    print(f"Scanning {INPUT_DIR}...")
    
    # 3つの時制のファイルを探す
    frames = {}
    for time_state in ["past", "present", "future"]:
        # ファイル名パターン: *_past_color.png 等
        pattern = os.path.join(INPUT_DIR, f"*_{time_state}_color.png")
        matches = glob.glob(pattern)
        
        if not matches:
            print(f"Error: '{time_state}' frame not found in {INPUT_DIR}")
            return
        
        # 最初の1セットだけ処理（複数セルある場合は要調整）
        frames[time_state] = matches[0]
        print(f"Found {time_state}: {os.path.basename(matches[0])}")

    # 画像をロード
    img_past = Image.open(frames["past"])
    img_present = Image.open(frames["present"])
    img_future = Image.open(frames["future"])

    # シーケンス作成 (往復ループ: 過去 -> 現在 -> 未来 -> 現在)
    # これで「揺らぎ」として見えるはずだ
    animation_frames = [img_past, img_present, img_future, img_present]

    # GIF保存
    img_past.save(
        OUTPUT_FILE,
        save_all=True,
        append_images=animation_frames[1:],
        duration=DURATION,
        loop=0
    )
    
    print("-" * 30)
    print(f"SUCCESS! Generated: {os.path.abspath(OUTPUT_FILE)}")
    print("-" * 30)

if __name__ == "__main__":
    main()