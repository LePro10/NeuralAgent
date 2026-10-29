/**
 * When the assistant needs a decision, it asks with options instead of a wall
 * of text. One or several questions (a small wizard with step dots), single
 * or multiple choice — radio vs. checkbox is told apart by shape (circle vs.
 * rounded square) — and always a way out: "Something else…" opens free text.
 */
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, Check, MessageCircleQuestion, PenLine, SendHorizontal } from 'lucide-react';
import { Button } from '../core/Button';
import { useState } from 'react';
import { cn } from '../../lib/cn';
import { haptic } from '../../lib/haptics';
import { useFinePointer } from '../../lib/hooks';
import { EASE, SPRING } from '../../lib/motion';

export interface Question {
  /** Short heading ("Time", "Scope"). */
  short?: string;
  question: string;
  options: string[];
  multiple?: boolean;
  /** Allow free text (default true). */
  free?: boolean;
}
export interface Answer { picked: string[]; text?: string }

export function QuestionCard({ questions, onSubmit, onSkip, title = 'Needs your answer', className }: {
  questions: Question[]; onSubmit: (answers: Answer[]) => void; onSkip?: () => void; title?: string; className?: string;
}) {
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const [picked, setPicked] = useState<string[][]>(() => questions.map(() => []));
  const [free, setFree] = useState<string[]>(() => questions.map(() => ''));
  const [freeOpen, setFreeOpen] = useState<boolean[]>(() => questions.map(() => false));
  const fine = useFinePointer();
  const q = questions[step];
  const lastStep = step === questions.length - 1;
  const answered = (i: number) => picked[i].length > 0 || !!free[i].trim();
  const go = (i: number) => { setDir(i > step ? 1 : -1); setStep(i); };
  const submit = () => { haptic('heavy'); onSubmit(questions.map((_, i) => ({ picked: picked[i], text: free[i].trim() || undefined }))); };

  const toggle = (o: string) => {
    haptic('select');
    setPicked((p) => p.map((v, i) => (i !== step ? v : q.multiple ? (v.includes(o) ? v.filter((x) => x !== o) : [...v, o]) : [o])));
    // Single choice in a wizard moves on by itself — one tap per question.
    if (!q.multiple && !lastStep) window.setTimeout(() => go(step + 1), 220);
  };

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={SPRING.pop}
      className={cn('card overflow-hidden !rounded-list', className)}>
      <div className="flex items-center gap-1.5 px-3.5 pt-3 text-meta text-dim">
        <MessageCircleQuestion size={13} strokeWidth={1.7} className="text-tab" />
        <span className="flex-1 truncate">{q.short ?? title}</span>
        {questions.length > 1 && (
          <span className="flex items-center gap-1" aria-label={`Question ${step + 1} of ${questions.length}`}>
            {questions.map((_, i) => (
              <button key={i} type="button" onClick={() => go(i)} aria-label={`Question ${i + 1}`}
                className={cn('relative h-1 rounded-full transition-all duration-300 ease-out-soft after:absolute after:-inset-2.5 after:content-[""]', i === step ? 'w-4 bg-tab' : answered(i) ? 'w-1 bg-tab/50' : 'w-1 bg-white/20')} />
            ))}
          </span>
        )}
      </div>
      <AnimatePresence mode="wait" initial={false} custom={dir}>
        <motion.div key={step} custom={dir} initial={{ opacity: 0, x: 10 * dir }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 * dir, transition: { duration: 0.12 } }} transition={{ duration: 0.22, ease: EASE.outSoft }} className="px-3.5 pt-1.5 pb-1">
          <p className="text-body leading-snug text-bright">{q.question}</p>
          {q.multiple && <p className="mt-0.5 text-meta text-dim">Pick any</p>}
          <div className="mt-2.5 flex flex-col gap-1.5">
            {q.options.map((o) => {
              const on = picked[step].includes(o);
              return (
                <button key={o} type="button" onClick={() => toggle(o)} aria-pressed={on}
                  className={cn('pressable flex min-h-11 w-full items-center gap-2.5 rounded-field px-3 py-2 text-left text-small transition-[background-color,box-shadow] min-[900px]:min-h-10',
                    on ? 'bg-tab/[.1] text-bright shadow-[inset_0_0_0_var(--hair)_color-mix(in_oklab,var(--color-tab)_45%,transparent)]' : 'bg-fill-1 text-ink shadow-edge hover:bg-fill-2')}>
                  <span className={cn('grid h-[18px] w-[18px] shrink-0 place-items-center border-[1.25px] transition-colors duration-200', q.multiple ? 'rounded-xs' : 'rounded-full', on ? 'border-transparent bg-tab text-bg' : 'border-white/25')}>
                    <AnimatePresence>{on && <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0, transition: { duration: 0.1 } }} transition={SPRING.toggle}><Check size={11} strokeWidth={3} /></motion.span>}</AnimatePresence>
                  </span>
                  <span className="min-w-0 flex-1">{o}</span>
                </button>
              );
            })}
            {q.free !== false && (freeOpen[step] ? (
              <textarea autoFocus rows={2} value={free[step]} placeholder="Your own answer"
                onChange={(e) => setFree((x) => x.map((v, i) => (i === step ? e.target.value : v)))}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && fine) { e.preventDefault(); if (lastStep) submit(); else go(step + 1); } }}
                className="well w-full resize-none rounded-field px-3 py-2 text-input text-bright outline-none placeholder:text-faint min-[900px]:text-small" />
            ) : (
              <button type="button" onClick={() => setFreeOpen((x) => x.map((v, i) => (i === step ? true : v)))} className="flex min-h-10 items-center gap-2 rounded-field px-3 text-small text-dim hover:bg-fill-1 hover:text-ink">
                <PenLine size={13} strokeWidth={1.7} />Something else…
              </button>
            ))}
          </div>
        </motion.div>
      </AnimatePresence>
      <div className="flex items-center gap-1.5 px-3.5 pt-1.5 pb-3">
        {step > 0
          ? <button type="button" onClick={() => go(step - 1)} aria-label="Previous question" className="pressable relative grid h-8 w-8 place-items-center rounded-full text-dim after:absolute after:-inset-1.5 after:content-[''] hover:bg-fill-2 hover:text-ink"><ArrowLeft size={15} strokeWidth={1.75} /></button>
          : onSkip && <Button size="sm" variant="quiet" onClick={onSkip}>Skip</Button>}
        <span className="flex-1" />
        {lastStep
          ? <Button size="sm" Icon={SendHorizontal} disabled={!questions.some((_, i) => answered(i))} onClick={submit}>Send</Button>
          : <Button size="sm" variant="ghost" onClick={() => go(step + 1)}>Next</Button>}
      </div>
    </motion.div>
  );
}
