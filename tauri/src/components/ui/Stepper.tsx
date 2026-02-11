"use client"

import { AnimatePresence, motion, Variants } from 'framer-motion';
import React, { Children, HTMLAttributes, JSX, ReactNode, useLayoutEffect, useRef, useState, useEffect } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import './Stepper.css';

interface StepperProps extends HTMLAttributes<HTMLDivElement> {
    children: ReactNode;
    steps: string[];
    initialStep?: number;
    currentStep?: number;
    onStepChange?: (step: number) => void;
    onFinalStepCompleted?: () => void;
    stepCircleContainerClassName?: string;
    stepContainerClassName?: string;
    contentClassName?: string;
    footerClassName?: string;
    backButtonProps?: React.ButtonHTMLAttributes<HTMLButtonElement>;
    nextButtonProps?: React.ButtonHTMLAttributes<HTMLButtonElement>;
    backButtonText?: string;
    nextButtonText?: string;
    disableStepIndicators?: boolean;
    renderStepIndicator?: (props: RenderStepIndicatorProps) => ReactNode;
    showFooter?: boolean;
    onBack?: () => void;
    onNext?: () => void;
}

interface RenderStepIndicatorProps {
    step: number;
    label: string;
    currentStep: number;
    onStepClick: (clicked: number) => void;
}

export default function Stepper({
    children,
    steps = [],
    initialStep = 1,
    currentStep: externalStep,
    onStepChange = () => { },
    onFinalStepCompleted = () => { },
    stepCircleContainerClassName = '',
    stepContainerClassName = '',
    contentClassName = '',
    footerClassName = '',
    backButtonProps = {},
    nextButtonProps = {},
    backButtonText = 'Back',
    nextButtonText = 'Continue',
    disableStepIndicators = false,
    renderStepIndicator,
    showFooter = true,
    onBack: externalBack,
    onNext: externalNext,
    ...rest
}: StepperProps) {
    const [internalStep, setInternalStep] = useState<number>(initialStep);
    const [direction, setDirection] = useState<number>(0);

    const currentStep = externalStep !== undefined ? externalStep : internalStep;

    const stepsArray = Children.toArray(children);
    const totalSteps = stepsArray.length;
    const isCompleted = currentStep > totalSteps;
    const isLastStep = currentStep === totalSteps;

    useEffect(() => {
        if (externalStep !== undefined) {
            // Sync direction when external step changes
            setDirection(externalStep > internalStep ? 1 : externalStep < internalStep ? -1 : 0);
            setInternalStep(externalStep);
        }
    }, [externalStep, internalStep]);

    const updateStep = (newStep: number) => {
        if (externalStep === undefined) {
            setInternalStep(newStep);
        }

        if (newStep > totalSteps) {
            onFinalStepCompleted();
        } else {
            onStepChange(newStep);
        }
    };

    const handleBack = () => {
        if (externalBack) {
            externalBack();
            return;
        }
        if (currentStep > 1) {
            setDirection(-1);
            updateStep(currentStep - 1);
        }
    };

    const handleNext = () => {
        if (externalNext) {
            externalNext();
            return;
        }
        if (!isLastStep) {
            setDirection(1);
            updateStep(currentStep + 1);
        }
    };

    const handleComplete = () => {
        setDirection(1);
        updateStep(totalSteps + 1);
    };

    return (
        <div className={cn("outer-container", rest.className)} {...rest}>
            <div className={cn("step-circle-container", stepCircleContainerClassName)}>
                <div className={cn("step-indicator-row", stepContainerClassName)}>
                    {stepsArray.map((_, index) => {
                        const stepNumber = index + 1;
                        const isNotLastStep = index < totalSteps - 1;
                        const label = steps[index] || "";
                        return (
                            <React.Fragment key={stepNumber}>
                                {renderStepIndicator ? (
                                    renderStepIndicator({
                                        step: stepNumber,
                                        label,
                                        currentStep,
                                        onStepClick: clicked => {
                                            if (disableStepIndicators) return;
                                            setDirection(clicked > currentStep ? 1 : -1);
                                            updateStep(clicked);
                                        }
                                    })
                                ) : (
                                    <StepIndicator
                                        step={stepNumber}
                                        label={label}
                                        disableStepIndicators={disableStepIndicators}
                                        currentStep={currentStep}
                                        onClickStep={clicked => {
                                            setDirection(clicked > currentStep ? 1 : -1);
                                            updateStep(clicked);
                                        }}
                                    />
                                )}
                                {isNotLastStep && <StepConnector isComplete={currentStep > stepNumber} />}
                            </React.Fragment>
                        );
                    })}
                </div>

                <StepContentWrapper
                    isCompleted={isCompleted}
                    currentStep={currentStep}
                    direction={direction}
                    className={cn("step-content-default", contentClassName)}
                >
                    {stepsArray[currentStep - 1]}
                </StepContentWrapper>

                {showFooter && !isCompleted && (
                    <div className={cn("footer-container", footerClassName)}>
                        <div className={cn("footer-nav", currentStep !== 1 ? 'spread' : 'end')}>
                            {currentStep !== 1 && (
                                <button
                                    onClick={handleBack}
                                    className={cn("back-button", currentStep === 1 ? 'inactive' : '')}
                                    {...backButtonProps}
                                >
                                    {backButtonText}
                                </button>
                            )}
                            <button
                                onClick={isLastStep ? handleComplete : handleNext}
                                className="next-button"
                                {...nextButtonProps}
                            >
                                {isLastStep ? 'Complete' : nextButtonText}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

interface StepContentWrapperProps {
    isCompleted: boolean;
    currentStep: number;
    direction: number;
    children: ReactNode;
    className?: string;
}

function StepContentWrapper({ isCompleted, currentStep, direction, children, className }: StepContentWrapperProps) {
    const [parentHeight, setParentHeight] = useState<number>(0);

    return (
        <motion.div
            className={className}
            style={{ position: 'relative', overflow: 'hidden' }}
            animate={{ height: isCompleted ? 0 : (parentHeight || 'auto') }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        >
            <AnimatePresence initial={false} mode="sync" custom={direction}>
                {!isCompleted && (
                    <SlideTransition key={currentStep} direction={direction} onHeightReady={h => setParentHeight(h)}>
                        {children}
                    </SlideTransition>
                )}
            </AnimatePresence>
        </motion.div>
    );
}

interface SlideTransitionProps {
    children: ReactNode;
    direction: number;
    onHeightReady: (h: number) => void;
}

function SlideTransition({ children, direction, onHeightReady }: SlideTransitionProps) {
    const containerRef = useRef<HTMLDivElement | null>(null);

    useLayoutEffect(() => {
        if (containerRef.current) {
            onHeightReady(containerRef.current.offsetHeight);
        }
    }, [children, onHeightReady]);

    return (
        <motion.div
            ref={containerRef}
            custom={direction}
            variants={stepVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            style={{ position: 'absolute', left: 0, right: 0, top: 0 }}
        >
            {children}
        </motion.div>
    );
}

const stepVariants: Variants = {
    enter: (dir: number) => ({
        x: dir >= 0 ? '100%' : '-100%',
        opacity: 0,
        filter: 'blur(10px)'
    }),
    center: {
        x: '0%',
        opacity: 1,
        filter: 'blur(0px)'
    },
    exit: (dir: number) => ({
        x: dir >= 0 ? '-100%' : '100%',
        opacity: 0,
        filter: 'blur(10px)'
    })
};

interface StepProps {
    children: ReactNode;
}

export function Step({ children }: StepProps): JSX.Element {
    return <div className="step-default">{children}</div>;
}

interface StepIndicatorProps {
    step: number;
    label: string;
    currentStep: number;
    onClickStep: (step: number) => void;
    disableStepIndicators?: boolean;
}

function StepIndicator({ step, label, currentStep, onClickStep, disableStepIndicators }: StepIndicatorProps) {
    const status = currentStep === step ? 'active' : currentStep > step ? 'complete' : 'inactive';

    const handleClick = () => {
        if (step !== currentStep && !disableStepIndicators) {
            onClickStep(step);
        }
    };

    return (
        <div className="flex flex-col items-center gap-1.5" onClick={handleClick}>
            <motion.div className="step-indicator" initial={false}>
                <motion.div
                    animate={{
                        scale: status === 'active' ? 1.1 : 1,
                        backgroundColor: status === 'inactive' ? 'hsl(var(--muted))' : 'hsl(var(--primary))',
                        color: status === 'inactive' ? 'hsl(var(--muted-foreground))' : 'hsl(var(--primary-foreground))',
                        borderColor: status === 'active' ? 'hsl(var(--primary) / 0.3)' : 'transparent'
                    }}
                    className="step-indicator-inner"
                >
                    {status === 'complete' ? (
                        <Check className="check-icon" />
                    ) : status === 'active' ? (
                        <div className="active-dot" />
                    ) : (
                        <span className="step-number">{step}</span>
                    )}
                </motion.div>
            </motion.div>
            {label && (
                <span
                    className={cn(
                        "text-[10px] font-medium whitespace-nowrap transition-colors",
                        status === 'inactive' ? 'text-muted-foreground/50' : 'text-primary'
                    )}
                >
                    {label}
                </span>
            )}
        </div>
    );
}

interface StepConnectorProps {
    isComplete: boolean;
}

function StepConnector({ isComplete }: StepConnectorProps) {
    return (
        <div className="step-connector">
            <motion.div
                className="step-connector-inner"
                initial={false}
                animate={{ width: isComplete ? '100%' : '0%' }}
                transition={{ duration: 0.4 }}
            />
        </div>
    );
}
