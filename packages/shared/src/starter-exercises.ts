// 由 scripts/import-catalogue.mjs 从固定版本数据选取，保留教学和素材来源。
import type { Exercise } from "./index.js";

export const starterExercises: Exercise[] = [
  {
    "id": "exdb_1760",
    "name": "哑铃高脚杯深蹲",
    "englishName": "dumbbell goblet squat",
    "aliases": [],
    "muscle": "legs",
    "secondaryMuscles": [],
    "equipment": "dumbbell",
    "mode": "reps",
    "volumeMultiplier": 1,
    "instructions": [
      "双脚分开与肩同宽站立，双手握住哑铃垂直放在胸前。",
      "保持胸部挺直，核心收紧，通过向后推臀部并弯曲膝盖，将身体降低至蹲姿。",
      "继续降低，直到大腿与地面平行，或者尽可能低。",
      "在底部停顿片刻，然后推动脚后跟回到起始位置。",
      "重复所需的重复次数。"
    ],
    "mistakes": [],
    "custom": false,
    "source": {
      "repository": "hasaneyldrm/exercises-dataset",
      "revision": "7455efae41b330c265e7cd4b78dfa848e7ce5ebd",
      "id": "1760",
      "license": "MIT",
      "url": "https://github.com/hasaneyldrm/exercises-dataset/blob/7455efae41b330c265e7cd4b78dfa848e7ce5ebd/data/exercises.json"
    }
  },
  {
    "id": "exdb_0293",
    "name": "俯身哑铃划船",
    "englishName": "dumbbell bent over row",
    "aliases": [],
    "muscle": "back",
    "secondaryMuscles": [
      "arms"
    ],
    "equipment": "dumbbell",
    "mode": "reps",
    "volumeMultiplier": 2,
    "instructions": [
      "双脚分开与肩同宽站立，膝盖稍微弯曲，双手各握一个哑铃，手掌朝向身体。",
      "臀部向前弯曲，保持背部挺直，核心肌群参与。",
      "让你的手臂垂直垂向地板，肘部稍微弯曲。",
      "将哑铃拉向胸部，将肩胛骨挤压在一起。",
      "在顶部停顿片刻，然后慢慢将哑铃放回起始位置。",
      "重复所需的重复次数。"
    ],
    "mistakes": [],
    "custom": false,
    "source": {
      "repository": "hasaneyldrm/exercises-dataset",
      "revision": "7455efae41b330c265e7cd4b78dfa848e7ce5ebd",
      "id": "0293",
      "license": "MIT",
      "url": "https://github.com/hasaneyldrm/exercises-dataset/blob/7455efae41b330c265e7cd4b78dfa848e7ce5ebd/data/exercises.json"
    }
  },
  {
    "id": "exdb_0289",
    "name": "平板哑铃卧推",
    "englishName": "dumbbell bench press",
    "aliases": [],
    "muscle": "chest",
    "secondaryMuscles": [
      "arms",
      "shoulders"
    ],
    "equipment": "dumbbell",
    "mode": "reps",
    "volumeMultiplier": 2,
    "instructions": [
      "平躺在长凳上，双脚平放在地上，背部紧贴长凳。",
      "双手各握一个哑铃，手掌朝前，双臂伸至胸部上方。",
      "慢慢地将哑铃降低到胸部两侧，保持肘部呈 90 度角。",
      "暂停片刻，然后将哑铃推回起始位置，完全伸展双臂。",
      "重复所需的重复次数。"
    ],
    "mistakes": [],
    "custom": false,
    "source": {
      "repository": "hasaneyldrm/exercises-dataset",
      "revision": "7455efae41b330c265e7cd4b78dfa848e7ce5ebd",
      "id": "0289",
      "license": "MIT",
      "url": "https://github.com/hasaneyldrm/exercises-dataset/blob/7455efae41b330c265e7cd4b78dfa848e7ce5ebd/data/exercises.json"
    }
  },
  {
    "id": "exdb_0300",
    "name": "哑铃硬拉",
    "englishName": "dumbbell deadlift",
    "aliases": [],
    "muscle": "legs",
    "secondaryMuscles": [
      "back"
    ],
    "equipment": "dumbbell",
    "mode": "reps",
    "volumeMultiplier": 2,
    "instructions": [
      "双脚分开与肩同宽站立，脚趾指向前方。",
      "双手各握一个哑铃，手掌朝向身体，手臂向下伸展。",
      "弯曲臀部和膝盖，将哑铃向地面降低，同时保持背部挺直。",
      "脚跟用力，伸展臀部和膝盖，将哑铃举回起始位置。",
      "重复所需的重复次数。"
    ],
    "mistakes": [],
    "custom": false,
    "source": {
      "repository": "hasaneyldrm/exercises-dataset",
      "revision": "7455efae41b330c265e7cd4b78dfa848e7ce5ebd",
      "id": "0300",
      "license": "MIT",
      "url": "https://github.com/hasaneyldrm/exercises-dataset/blob/7455efae41b330c265e7cd4b78dfa848e7ce5ebd/data/exercises.json"
    }
  },
  {
    "id": "exdb_0336",
    "name": "哑铃箭步蹲",
    "englishName": "dumbbell lunge",
    "aliases": [],
    "muscle": "legs",
    "secondaryMuscles": [],
    "equipment": "dumbbell",
    "mode": "reps",
    "volumeMultiplier": 2,
    "instructions": [
      "双脚分开与肩同宽站立，每只手各握一个哑铃。",
      "右脚向前迈出一步，将身体降低至弓步位置。",
      "降低身体时保持背部挺直、挺胸。",
      "推动右脚跟回到起始位置。",
      "左腿重复上述动作。",
      "交替腿进行所需的重复次数。"
    ],
    "mistakes": [],
    "custom": false,
    "source": {
      "repository": "hasaneyldrm/exercises-dataset",
      "revision": "7455efae41b330c265e7cd4b78dfa848e7ce5ebd",
      "id": "0336",
      "license": "MIT",
      "url": "https://github.com/hasaneyldrm/exercises-dataset/blob/7455efae41b330c265e7cd4b78dfa848e7ce5ebd/data/exercises.json"
    }
  },
  {
    "id": "exdb_1460",
    "name": "行走弓步蹲",
    "englishName": "walking lunge",
    "aliases": [],
    "muscle": "legs",
    "secondaryMuscles": [],
    "equipment": "bodyweight",
    "mode": "reps",
    "volumeMultiplier": 1,
    "instructions": [
      "双脚分开与肩同宽站立。",
      "右腿向前迈出一步，将身体降低至弓步位置。",
      "保持躯干直立，前膝与脚踝对齐。",
      "右脚蹬地，左脚向前，左腿呈弓步姿势。",
      "继续交替双腿向前行走，保持受控且稳定的步伐。",
      "重复所需的重复次数。"
    ],
    "mistakes": [],
    "custom": false,
    "source": {
      "repository": "hasaneyldrm/exercises-dataset",
      "revision": "7455efae41b330c265e7cd4b78dfa848e7ce5ebd",
      "id": "1460",
      "license": "MIT",
      "url": "https://github.com/hasaneyldrm/exercises-dataset/blob/7455efae41b330c265e7cd4b78dfa848e7ce5ebd/data/exercises.json"
    }
  }
];
