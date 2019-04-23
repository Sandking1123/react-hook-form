import { useRef, useState, useEffect } from 'react';
import getFieldsValues from './logic/getFieldsValues';
import validateField from './logic/validateField';
import findMissDomAndClean from './logic/findMissDomAndClean';
import getFieldValue from './logic/getFieldValue';
import onDomRemove from './utils/onDomRemove';
import isRadioInput from './utils/isRadioInput';
import attachEventListeners from './logic/attachEventListeners';
import validateWithSchema from './logic/validateWithSchema';
import combineFieldValues from './logic/combineFieldValues';
import shouldUpdateWithError from './logic/shouldUpdateWithError';
import { Props, IField, IErrorMessages, Ref } from './type';

export default function useForm(
  { mode, validationSchema }: Props = {
    mode: 'onSubmit',
  },
) {
  const fieldsRef = useRef<{ [key: string]: IField }>({});
  const errorMessagesRef = useRef<IErrorMessages>({});
  const isWatchAllRef = useRef<boolean>(false);
  const watchFieldsRef = useRef<{ [key: string]: boolean }>({});
  const [errors, setErrors] = useState<IErrorMessages>({});
  const isSubmitted = useRef<boolean>(false);
  const isDirty = useRef<boolean>(false);
  const touched = useRef<Array<string>>([]);

  async function validateAndStateUpdate({ target: { name }, type }: any) {
    const ref = fieldsRef.current[name];
    const errorMessages = errorMessagesRef.current;
    const onSubmitModeNotSubmitted = !isSubmitted.current && mode === 'onSubmit';
    const isWatchAll = isWatchAllRef.current;
    let shouldUpdateState = isWatchAll;

    if (!isDirty.current) {
      isDirty.current = true;
      shouldUpdateState = true;
    }

    if (!touched.current.includes(name)) {
      touched.current.push(name);
      shouldUpdateState = true;
    }

    if (onSubmitModeNotSubmitted && (isWatchAll || watchFieldsRef.current[name])) {
      return setErrors({});
    }

    const error = await validateField(ref, fieldsRef.current);

    if (
      shouldUpdateWithError({ errorMessages, name, error, mode, onSubmitModeNotSubmitted, type }) ||
      mode === 'onChange' ||
      (mode === 'onBlur' && type === 'blur') ||
      watchFieldsRef.current[name]
    ) {
      const copy = { ...errorMessages, ...error };

      if (!error[name]) delete copy[name];

      errorMessagesRef.current = copy;
      setErrors(copy);
      return;
    }

    if (shouldUpdateState) {
      setErrors(errorMessages);
    }
  }

  const removeReferenceAndEventListeners = findMissDomAndClean.bind(null, fieldsRef.current, validateAndStateUpdate);

  function registerIntoAllFields(elementRef, data = { required: false, validate: undefined }) {
    if (elementRef && !elementRef.name) {
      return console.warn('Oops missing the name for field:', elementRef);
    }

    const inputData = {
      ...data,
      ref: elementRef,
    };
    const {
      ref,
      required,
      validate,
      ref: { name, type, value },
    } = inputData;
    const fields = fieldsRef.current;
    const isRadio = isRadioInput(type);
    const radioOptionIndex = isRadio ? fields[name].options.findIndex(({ ref }) => value === ref.value) : -1;

    if (fieldsRef.current[name] && radioOptionIndex > -1) return;

    if (isRadio) {
      if (!fields[name]) {
        fields[name] = { options: [], required, validate, ref: { type: 'radio', name } };
      }

      if (!fields[name].validate && validate) {
        fields[name].validate = validate;
      }

      fields[name].options.push({
        ...inputData,
        mutationWatcher: onDomRemove(ref, () => removeReferenceAndEventListeners(inputData, true)),
      });
    } else {
      fields[name] = {
        ...inputData,
        mutationWatcher: onDomRemove(ref, () => removeReferenceAndEventListeners(inputData, true)),
      };
    }

    attachEventListeners({
      field: isRadio ? fields[name].options[fields[name].options.length - 1] : fields[name],
      isRadio,
      validateAndStateUpdate,
    });
  }

  function watch(filedNames?: string | Array<string> | undefined, defaultValue?: string | Array<string> | undefined) {
    const watchFields = watchFieldsRef.current;

    if (typeof filedNames === 'string') {
      if (!watchFields[filedNames]) watchFields[filedNames] = true;
    } else if (Array.isArray(filedNames)) {
      filedNames.forEach(name => {
        watchFields[name] = true;
      });
    } else {
      isWatchAllRef.current = true;
    }

    const result = getFieldsValues(fieldsRef.current, filedNames);
    return result === undefined ? defaultValue : result;
  }

  function register(data: Ref) {
    if (!data) return;
    if (data.type) {
      if (!data.name) console.warn('Oops missing the name for field:', data);
      registerIntoAllFields(data);
    }
    if (fieldsRef.current[data.name]) return;

    return ref => {
      if (ref) registerIntoAllFields(ref, data);
    };
  }

  const handleSubmit = (callback: (Object, e) => void) => async e => {
    if (e) {
      e.preventDefault();
      e.persist();
    }
    let fieldErrors;
    let fieldValues;
    const fields = fieldsRef.current;
    const currentFieldValues = Object.values(fields);
    isSubmitted.current = true;

    if (validationSchema) {
      fieldValues = currentFieldValues.reduce((previous, { ref }) => {
        previous[ref.name] = getFieldValue(fields, ref);
        return previous;
      }, {});
      fieldErrors = await validateWithSchema(validationSchema, fieldValues);

      if (fieldErrors === undefined) {
        callback(combineFieldValues(fieldValues), e);
        return;
      }
    } else {
      const result: {
        errors: { [key: string]: Error };
        values: { [key: string]: number | string | boolean };
      } = await currentFieldValues.reduce(
        async (previous: any, field: IField) => {
          const resolvedPrevious = await previous;
          const {
            ref,
            ref: { name },
          } = field;

          if (!fields[name]) return Promise.resolve(resolvedPrevious);

          const fieldError = await validateField(field, fields);
          const hasError = fieldError && fieldError[name];

          if (!hasError) {
            resolvedPrevious.values[name] = getFieldValue(fields, ref);
            return Promise.resolve(resolvedPrevious);
          }

          resolvedPrevious.errors = { ...(resolvedPrevious.errors || {}), ...fieldError };
          return Promise.resolve(resolvedPrevious);
        },
        Promise.resolve({
          errors: {},
          values: {},
        }),
      );

      fieldErrors = result.errors;
      fieldValues = result.values;
    }

    if (Object.values(fieldErrors).length) {
      setErrors(fieldErrors);
      errorMessagesRef.current = fieldErrors;
      return;
    }

    callback(combineFieldValues(fieldValues), e);
  };

  const unSubscribe = () => {
    fieldsRef.current &&
      Object.values(fieldsRef.current).forEach((field: IField) => {
        const { ref, options } = field;
        isRadioInput(ref.type) && Array.isArray(options)
          ? options.forEach(fieldRef => removeReferenceAndEventListeners(fieldRef, true))
          : removeReferenceAndEventListeners(field, true);
      });
    fieldsRef.current = {};
    watchFieldsRef.current = {};
    errorMessagesRef.current = {};
    isWatchAllRef.current = false;
    isSubmitted.current = false;
    isDirty.current = false;
    touched.current = [];
    setErrors({});
  };

  useEffect(() => () => unSubscribe, [mode]);

  return {
    register,
    handleSubmit,
    errors,
    watch,
    unSubscribe,
    formState: {
      dirty: isDirty.current,
      isSubmitted: isSubmitted.current,
      touched: touched.current,
    },
  };
}
