import { forwardRef, useImperativeHandle } from 'react';
import L from 'leaflet';
import '../vendor/leaflet-heat.js';
import { createElementHook, createLayerHook } from '@react-leaflet/core';

export const STRESS_HEAT_GRADIENT = {
  0.2: '#2e7d32',
  0.45: '#f9a825',
  0.65: '#ef6c00',
  0.9: '#c62828',
};

function createHeatLayer({ points, radius = 50, blur = 40 }) {
  if (typeof L.heatLayer !== 'function') {
    throw new Error('leaflet.heat plugin not loaded — window.L was missing at import time');
  }
  const instance = L.heatLayer(points, {
    radius, blur, maxZoom: 14, minOpacity: 0.3,
    gradient: STRESS_HEAT_GRADIENT,
  });
  return { instance, context: {} };
}

function updateHeatLayer(instance, props, prevProps) {
  if (props.points !== prevProps.points) instance.setLatLngs(props.points);
  if (props.radius !== prevProps.radius || props.blur !== prevProps.blur) {
    instance.setOptions({ radius: props.radius, blur: props.blur });
  }
}

const useHeatLayerElement = createElementHook(createHeatLayer, updateHeatLayer);
const useHeatLayer = createLayerHook(useHeatLayerElement);

function StressHeatLayerComponent(props, forwardedRef) {
  const elementRef = useHeatLayer(props);
  useImperativeHandle(forwardedRef, () => elementRef.current.instance);
  return null;
}

export default forwardRef(StressHeatLayerComponent);
