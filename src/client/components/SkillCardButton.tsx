import React from 'react';
import { SkillCard, SkillCardType, SkillCardNames } from '../../shared/types';

interface Props { skill: SkillCard; onClick: () => void; disabled?: boolean; }
const descriptions: Record<SkillCardType, string> = {
  [SkillCardType.DrawTwo]: '获得 2 张随机牌',
  [SkillCardType.Steal]: '从指定玩家手中随机获得 1 张牌',
  [SkillCardType.Discard]: '让指定玩家随机弃 1 张牌',
  [SkillCardType.Skip]: '让指定玩家跳过下个回合',
  [SkillCardType.Harvest]: '所有未出完牌的玩家各获得 1 张牌',
};
const icons = { [SkillCardType.DrawTwo]: '+2', [SkillCardType.Steal]: '牵', [SkillCardType.Discard]: '拆', [SkillCardType.Skip]: '跳', [SkillCardType.Harvest]: '丰' };

export const SkillCardButton: React.FC<Props> = ({ skill, onClick, disabled }) => (
  <button type="button" onClick={onClick} disabled={disabled} className="game-skill" title={`${SkillCardNames[skill.type]}：${descriptions[skill.type]}`}>
    <span className="game-skill__icon" aria-hidden="true">{icons[skill.type]}</span>
    <span><strong>{SkillCardNames[skill.type]}</strong><small>{descriptions[skill.type]}</small></span>
  </button>
);
