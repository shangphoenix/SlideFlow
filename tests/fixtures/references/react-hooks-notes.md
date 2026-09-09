# React Hooks Notes

Hooks let a function component hold state and subscribe to external systems without a class. The rule that trips people up is that hooks must be called in the same order on every render, which is why they cannot appear inside conditionals or loops. React tracks them positionally in a linked list attached to the fiber, so a skipped call shifts every subsequent hook onto the wrong slot.

The useState hook returns a value and a setter. Calling the setter schedules a re-render rather than mutating anything immediately, so reading the state variable directly after calling the setter gives you the old value. When the next value depends on the previous one, pass a function to the setter instead of a value, because React may batch several updates together before it re-renders.

The useEffect hook runs after the browser has painted. Its dependency array is compared with Object.is on every render, and the effect re-runs whenever any entry differs. An effect that returns a function gets that function called as cleanup before the next run and once more on unmount. Forgetting the cleanup is the usual cause of a subscription leak or a state update on an unmounted component.

Memoisation hooks solve a narrower problem than most codebases use them for. useMemo caches a computed value and useCallback caches a function identity, both keyed on a dependency array. They are worth reaching for when an expensive computation dominates a render, or when a referentially stable prop keeps a memoised child from re-rendering. Applied everywhere by reflex they add allocation and dependency-array bugs without measurably helping.

Custom hooks are the composition mechanism. A function whose name starts with use and which calls other hooks is a custom hook, and it shares stateful logic between components without the wrapper nesting that higher-order components produced. Each component calling a custom hook gets its own independent state.
