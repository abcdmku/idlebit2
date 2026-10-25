import type { TaskTypeId } from '../../game';
import { typeColor, typeName } from '../../render/core';
import './answers.css';

export function ResearchAnswers({ answers = [] }: { answers: readonly TaskTypeId[] }) {
  if (!answers.length) return null;
  return <div className="research-answers" aria-label="Answers">
    {answers.map(type => <span key={type} data-task-type={type} style={{ color: typeColor(type) }}>
      {typeName(type)}
    </span>)}
  </div>;
}
