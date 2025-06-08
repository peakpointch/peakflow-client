// Imports
import createAttribute, { exclude } from "@peakflow/attributeselector";
import {
  initWfInputs,
  sendFormData,
  validateFields,
  formElementSelector,
  fieldFromInput,
  enforceButtonTypes,
  FormFieldMap,
} from "@peakflow/form";
import wf from "@peakflow/webflow";
import { HTMLFormInput, CustomValidator } from "@peakflow/form";
import { FormDecision } from "@peakflow/form";
import { ProspectArray } from "./prospect-array";
import { flattenProspects } from "./resident-prospect";
import mapToObject from "@peakflow/maptoobject"
import deepMerge from "@peakflow/deepmerge";

// Types
type FormOptions = {
  excludeInputSelectors: string[];
  recaptcha: boolean;
}
interface MultiStepFormOptions extends FormOptions {
  navigation: {
    hideInStep: number;
  };
  pagination: {
    doneClass: string;
    activeClass: string;
  }
  onStepChange?: StepChangeCallback;
  nested: boolean;
};
type StepChangeCallback = (options: {
  index: number;
  currentStep: HTMLElement;
  targetStep: HTMLElement;
}) => void;
type CustomFormComponent = {
  stepIndex: number;
  instance: any;
  validator: CustomValidator;
  getData?: () => {};
};
type StepsComponentElement = 'component' | 'list' | 'step' | 'navigation' | 'pagination' | 'custom-component';
type StepsNavElement = 'prev' | 'next';

// Selector functions
const stepsElementSelector = createAttribute<StepsComponentElement>('data-steps-element', {
  defaultExclusions: ['[data-steps-element="component"] [data-steps-element="component"] *']
});
const stepsTargetSelector = createAttribute<string>('data-step-target');
const stepsNavSelector = createAttribute<StepsNavElement>('data-steps-nav');

const STEPS_PAGINATION_ITEM_SELECTOR: string = `button${stepsTargetSelector()}`;
class MultiStepForm {
  public options: MultiStepFormOptions = {
    recaptcha: false,
    navigation: {
      hideInStep: -1,
    },
    excludeInputSelectors: [],
    nested: false,
    pagination: {
      doneClass: "is-done",
      activeClass: "is-active"
    }
  };

  public initialized: boolean = false;
  public component: HTMLElement;
  public formElement: HTMLFormElement | HTMLElement;
  public formSteps: NodeListOf<HTMLElement>;
  private set currentStep(index: number) {
    this._currentStep = index;
  }
  public get currentStep(): number {
    return this._currentStep;
  }
  private _currentStep: number = 0;
  private navigationElement: HTMLElement;
  private paginationItems: NodeListOf<HTMLElement>;
  private buttonsNext: NodeListOf<HTMLElement>;
  private buttonsPrev: NodeListOf<HTMLElement>;
  private customComponents: Array<CustomFormComponent> = [];
  private successElement: HTMLElement | null;
  private errorElement: HTMLElement | null;
  private submitButton: HTMLInputElement | null;

  constructor(component: HTMLElement, options: Partial<MultiStepFormOptions>) {
    this.component = component;
    this.options = deepMerge(this.options, options);

    this.validateComponent();
    this.cacheDomElements();
    this.setupForm();
    this.setupEventListeners();
    this.initialized = true;
  }

  private validateComponent(): void {
    if (!this.component.getAttribute("data-steps-element")) {
      console.error(
        `Form Steps: Component is not a steps component or is missing the attribute ${stepsElementSelector('component')}.\nComponent:`,
        this.component
      );
      throw new Error("Component is not a valid multi-step form component.");
    }
  }

  private cacheDomElements(): void {
    this.formElement = this.component.querySelector<HTMLFormElement>('form');
    if (!this.options.nested && !this.formElement) {
      throw new Error("Form element not found within the specified component.");
    }

    if (this.options.nested) {
      this.formElement = this.component;
    }

    this.formSteps = this.component.querySelectorAll(stepsElementSelector('step'));
    this.paginationItems = this.component.querySelectorAll(STEPS_PAGINATION_ITEM_SELECTOR);
    this.navigationElement = this.component.querySelector(stepsElementSelector('navigation'));
    this.buttonsNext = this.component.querySelectorAll(stepsNavSelector('next'));
    this.buttonsPrev = this.component.querySelectorAll(stepsNavSelector('prev'));

    this.successElement = this.component.querySelector(formElementSelector('success'));
    this.errorElement = this.component.querySelector(formElementSelector('error'));
    this.submitButton = this.component.querySelector<HTMLInputElement>(formElementSelector('submit'));
  }

  private setupForm(): void {
    if (!this.formSteps.length) {
      console.warn(
        `Form Steps: The selected list doesn't contain any steps. Skipping initialization. Provided List:`,
        this.component.querySelector(stepsElementSelector('list'))
      );
      return;
    }

    if (!this.options.nested) {
      enforceButtonTypes(this.formElement as HTMLFormElement);
      this.formElement.setAttribute("novalidate", "");
    }

    this.formElement.dataset.state = "initialized";

    initWfInputs(this.component);

    this.changeToStep(this.currentStep);
  }

  private setupEventListeners(): void {
    if (!this.options.nested) {
      this.formElement.addEventListener("submit", (event) => {
        event.preventDefault();
        this.submitToWebflow();
      });
    }

    this.initPagination();
    this.initChangeStepOnKeydown();
  }

  public addCustomComponent(component: CustomFormComponent): void {
    this.customComponents.push(component);
  }

  private async submitToWebflow(): Promise<void> {
    if (this.options.nested) {
      throw new Error(`Can't submit a nested MultiStepForm.`);
    }

    if (this.currentStep !== this.formSteps.length - 1) {
      console.error(
        "SUBMIT ERROR: the current step is not the last step. Can only submit the MultiStepForm in the last step."
      );
      return;
    }

    const allStepsValid = this.validateAllSteps();

    if (!allStepsValid) {
      console.warn("Form submission blocked: Not all steps are valid.");
      return;
    }

    this.formElement.dataset.state = "sending";
    if (this.submitButton) {
      this.submitButton.dataset.defaultText = this.submitButton.value;
      this.submitButton.value =
        this.submitButton.dataset.wait || "Wird gesendet ...";
    }

    const formData = this.buildJsonForWebflow();
    console.log(formData);

    // Submit form
    const success = await sendFormData(formData);

    if (success) {
      this.onFormSuccess();
    } else {
      this.onFormError();
    }
  }

  private buildJsonForWebflow(): any {
    if (this.options.nested) {
      throw new Error(`Can't get FormData for a nested MultiStepForm.`);
    }

    const fields = this.getFormData();

    if (this.options.recaptcha) {
      const recaptcha = (this.formElement.querySelector("#g-recaptcha-response") as HTMLFormInput).value;
      fields["g-recaptcha-response"] = recaptcha;
    }

    return {
      name: this.formElement.dataset.name,
      pageId: wf.pageId,
      elementId: this.formElement.dataset.wfElementId,
      source: window.location.href,
      test: false,
      fields: fields,
      dolphin: false,
    };
  }

  private onFormSuccess(): void {
    if (this.errorElement) this.errorElement.style.display = "none";
    if (this.successElement) this.successElement.style.display = "block";
    this.formElement.style.display = "none";
    this.formElement.dataset.state = "success";
    this.formElement.dispatchEvent(new CustomEvent("formSuccess"));

    if (this.submitButton) {
      this.submitButton.value =
        this.submitButton.dataset.defaultText || "Submit";
    }
  }

  private onFormError(): void {
    if (this.errorElement) this.errorElement.style.display = "block";
    if (this.successElement) this.successElement.style.display = "none";
    this.formElement.dataset.state = "error";
    this.formElement.dispatchEvent(new CustomEvent("formError"));

    if (this.submitButton) {
      this.submitButton.value =
        this.submitButton.dataset.defaultText || "Submit";
    }
  }

  private initChangeStepOnKeydown(): void {
    this.formSteps.forEach((step, index) => {
      step.dataset.stepId = index.toString();
      step.classList.toggle("hide", index !== this.currentStep);

      step
        .querySelectorAll<HTMLInputElement>(wf.select.formInput) // Type necessary for keydown event
        .forEach((input) => {
          input.addEventListener("keydown", (event: KeyboardEvent) => {
            if (event.key === "Enter") {
              event.preventDefault();
              this.changeToNext();
            }
          });
        });
    });
  }

  private initPagination(): void {
    this.paginationItems.forEach((item, index) => {
      item.dataset.stepTarget = index.toString();
      item.addEventListener("click", (event) => {
        event.preventDefault();
        this.changeToStep(index);
      });
    });

    this.buttonsNext.forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        this.changeToNext();
      });
    });

    this.buttonsPrev.forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        this.changeToPrevious();
      });
    });
  }

  /**
   * Change to the next step.
   */
  public changeToNext() {
    if (this.currentStep < this.formSteps.length - 1) {
      this.changeToStep(this.currentStep + 1);
    }
  }

  /**
   * Change to the previous step.
   */
  public changeToPrevious() {
    if (this.currentStep > 0) {
      this.changeToStep(this.currentStep - 1);
    }
  }

  /**
   * Change to the specified step by `index`.
   *
   * If moving forward, the method will validate all intermediate steps before
   * allowing navigation. If validation fails on any step, it will halt and move
   * to the invalid step instead.
   *
   * Use the CustomEvent "changeStep" to hook into step changes.
   *
   * @param index - The zero-based index of the step to navigate to.
   */
  public changeToStep(index: number): void {
    if (this.currentStep === index && this.initialized) {
      // console.log('Change Form Step: Target step equals current step.');
      // console.log(`Step ${this.currentStep + 1}/${this.formSteps.length}`);
      return;
    }

    if (index > this.currentStep && this.initialized) {
      for (let step = this.currentStep; step < index; step++) {
        // Validate standard fields in the current step
        if (!this.validateCurrentStep(step)) {
          this.changeToStep(step);
          return;
        }
      }

      this.component.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }

    // Fire custom event before updating the visibility
    const event = new CustomEvent("changeStep", {
      detail: { previousStep: this.currentStep, currentStep: index },
    });
    this.component.dispatchEvent(event);

    this.updateStepVisibility(index);
    this.updatePagination(index);
    this.currentStep = index;
    console.log(`Step ${this.currentStep + 1}/${this.formSteps.length}`);
  }

  private updateStepVisibility(target: number): void {
    const current = this.formSteps[this.currentStep];
    const next = this.formSteps[target];

    // Call user-defined handler if set
    if (this.options.onStepChange) {
      this.options.onStepChange({
        index: target,
        currentStep: current,
        targetStep: next,
      });
    } else {
      // Default behavior
      current.classList.add("hide");
      next.classList.remove("hide");
    }
  }

  public set onChangeStep(callback: StepChangeCallback) {
    this.options.onStepChange = callback;
  }

  private updatePagination(target: number): void {
    this.buttonsPrev.forEach((button) => {
      if (target === 0) {
        button.style.visibility = "hidden";
        button.style.opacity = "0";
      } else {
        button.style.visibility = "visible";
        button.style.opacity = "1";
      }
    });

    this.buttonsNext.forEach((button) => {
      if (target === this.formSteps.length - 1) {
        button.style.visibility = "hidden";
        button.style.opacity = "0";
      } else {
        button.style.visibility = "visible";
        button.style.opacity = "1";
      }
    });

    if (target === this.options.navigation.hideInStep) {
      this.navigationElement.style.visibility = "hidden";
      this.navigationElement.style.opacity = "0";
    } else {
      this.navigationElement.style.removeProperty("visibility");
      this.navigationElement.style.removeProperty("opacity");
    }

    this.paginationItems.forEach((step, index) => {
      step.classList.toggle(this.options.pagination.doneClass, index < target);
      step.classList.toggle(this.options.pagination.activeClass, index === target);
    });
  }

  public validateAllSteps(): boolean {
    let allValid = true;

    this.formSteps.forEach((_, index) => {
      if (!this.validateCurrentStep(index)) {
        console.warn(`Step ${index + 1} is invalid.`);
        allValid = false; // Set the flag to false if any step is invalid
        this.changeToStep(index);
      }
    });

    return allValid;
  }

  public validateCurrentStep(stepIndex: number): boolean {
    //return true; // Change this for dev
    const basicError = `Validation failed for step: ${stepIndex + 1}/${this.formSteps.length
      }`;
    const currentStepElement = this.formSteps[stepIndex];
    const inputs: NodeListOf<HTMLFormInput> =
      currentStepElement.querySelectorAll(wf.select.formInput);

    // TODO: Fix this overkill approach
    const filteredInputs = Array.from(inputs).filter((input) => {
      // Check if the input matches any exclude selectors or is inside an excluded wrapper
      const isExcluded = this.options.excludeInputSelectors.some(
        (selector) => {
          return (
            input.closest(`${selector}`) !== null || input.matches(selector)
          );
        }
      );
      return !isExcluded;
    });

    let { isValid } = validateFields(filteredInputs);

    if (!isValid) {
      console.warn(`${basicError}: Standard validation is not valid`);
      return isValid;
    }

    const customValidators: CustomValidator[] = this.customComponents
      .filter((entry) => entry.stepIndex === stepIndex)
      .map((entry) => () => entry.validator());

    // Custom validations
    const customValid =
      customValidators?.every((validator) => validator()) ?? true;
    if (!customValid) {
      console.warn(`${basicError}: Custom validation is not valid`);
    }

    return isValid && customValid;
  }

  /**
   * Gets data of all form fields in a `FormFieldMap`.
   *
   * @step Step index of the multi step form
   * @returns `FormFieldMap` - A map of field id (string) to a `FormField` class instance
   *
   * Fields that are a descendant of '[data-steps-element="custom-component"]' are excluded.
   */
  public getFieldMapForStep(step: number): FormFieldMap {
    let fields: FormFieldMap = new Map();

    const stepElement = this.formSteps[step];
    const stepInputs: NodeListOf<HTMLFormInput> =
      stepElement.querySelectorAll(exclude(wf.select.formInput, `${stepsElementSelector("custom-component")} ${wf.select.formInput}`));
    stepInputs.forEach((input, inputIndex) => {
      const entry = fieldFromInput(input, inputIndex);
      if (entry?.id) {
        fields.set(entry.id, entry.value);
      }
    });

    return fields;
  }

  public getFieldMap(): FormFieldMap {
    const fields = Array.from(this.formSteps).reduce((acc, _, stepIndex) => {
      const stepData = this.getFieldMapForStep(stepIndex);
      return new Map([
        ...acc,
        ...stepData
      ]);
    }, new Map() as FormFieldMap);

    return fields;
  }

  public getFormData(): any {
    const customFields = this.customComponents.reduce((acc, entry) => {
      return {
        ...acc,
        ...(entry.getData ? entry.getData() : {}),
      };
    }, {});

    const fields = {
      ...mapToObject(this.getFieldMap(), false),
      ...customFields,
    }

    return fields;
  }
}

function capitalize(str: string): string {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function reinsertElement(element: HTMLElement): void {
  // Check if the element and its parent are defined
  if (!element || !element.firstElementChild) {
    console.warn("Element or its first element child is not defined.");
    return;
  }

  const childElement = element.firstElementChild;

  // Remove the element from its parent
  element.removeChild(childElement);

  // Use setTimeout to ensure the reinsert happens asynchronously
  setTimeout(() => {
    // Append the element back to the parent
    element.appendChild(childElement);

    // Focus the element if it's meant to be interactive
    element.focus();
  }, 0);
}

function decisionSelector(id?: number | string) {
  return id ? `[data-decision-component="${id}"]` : `[data-decision-component]`;
}

function initializeFormDecisions(
  form: MultiStepForm,
  errorMessages: { [id: string]: { [key: string]: string } },
  defaultMessages: { [id: string]: string } = {}
): void {
  form.formSteps.forEach((step, stepIndex) => {
    const formDecisions = step.querySelectorAll<HTMLElement>(
      decisionSelector()
    );

    formDecisions.forEach((element) => {
      const id = element.dataset.decisionComponent;
      const decision = new FormDecision(element, id);

      // Set error messages for this FormDecision if available
      if (id && errorMessages[id]) {
        decision.setErrorMessages(errorMessages[id], defaultMessages[id]);
      }

      // Add the FormDecision as a custom component to the form
      form.addCustomComponent({
        stepIndex,
        instance: decision,
        validator: () => decision.validate(),
      });
    });
  });
}

function initializeOtherFormDecisions(
  form: HTMLElement,
  errorMessages: { [id: string]: { [key: string]: string } },
  defaultMessages: { [id: string]: string } = {}
): void {
  const formDecisions = form.querySelectorAll<HTMLElement>(decisionSelector());

  formDecisions.forEach((element) => {
    const id = element.dataset.decisionComponent;
    const decision = new FormDecision(element, id);

    // Set error messages for this FormDecision if available
    if (id && errorMessages[id]) {
      decision.setErrorMessages(errorMessages[id], defaultMessages[id]);
    }
  });
}

function insertSearchParamValues(): void {
  if (window.location.search) {
    const params = new URLSearchParams(window.location.search);
    const selectElement = document.querySelector(
      "#wohnung"
    ) as HTMLInputElement;

    const wohnungValue = params.get("wohnung");
    const option = selectElement.querySelector(
      `option[value="${wohnungValue}"]`
    );
    if (wohnungValue && option) {
      // If you want to handle cases where the value doesn't exist
      selectElement.value = wohnungValue;
    } else {
      console.warn(`No matching option for value: ${wohnungValue}`);
    }
  }
}

const formElement: HTMLElement | null = document.querySelector(
  formElementSelector('component', { exclusions: [] })
);
formElement?.classList.remove("w-form");

document.addEventListener("DOMContentLoaded", () => {
  if (!formElement) {
    console.error("Form not found.");
    return;
  }

  const prospectArray = new ProspectArray(formElement, "resident-prospects");
  const FORM = new MultiStepForm(formElement, {
    navigation: {
      hideInStep: 0,
    },
    recaptcha: true,
    excludeInputSelectors: [
      '[data-decision-path="upload"]',
      '[data-decision-component]',
    ],
  });

  FORM.changeToStep(2);

  // @ts-ignore
  window.prospectArray = prospectArray;

  FORM.addCustomComponent({
    stepIndex: 2,
    instance: prospectArray,
    validator: () => prospectArray.validate(),
    getData: () => flattenProspects(prospectArray.prospects)
  });
  FORM.component.addEventListener("changeStep", () => {
    if (prospectArray.modal.opened) prospectArray.closeModal();
  });

  const errorMessages = {
    beilagenSenden: {
      upload: "Bitte laden Sie alle Beilagen hoch.",
    },
  };

  const defaultMessages = {
    beilagenSenden: `Bitte laden Sie alle Beilagen hoch oder wählen Sie die Option "Beilagen per Post senden".`,
  };

  initializeOtherFormDecisions(
    prospectArray.modalElement,
    errorMessages,
    defaultMessages
  );
  initializeFormDecisions(FORM, errorMessages, defaultMessages);
  insertSearchParamValues();
  prospectArray.loadProgress();
  FORM.formElement.addEventListener("formSuccess", () => {
    prospectArray.clearProgress();
  });

  console.log("Form initialized:", FORM.initialized, FORM);
});
