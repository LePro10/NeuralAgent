// One definition of "the page may run the sticky live stage": room (a 1280 px window cannot be worked with a thumb) and
// a mouse. Everything else (phones, tablets, touch laptops in tablet mode) gets stacked chapters with posters.
// The same query is mirrored in Hero.css and Stage.css (they cannot import it), keep them in step.
export const STICKY = "(min-width: 900px) and (hover: hover) and (pointer: fine)";
