/*
 * Copyright 2021 The Backstage Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  CompoundEntityRef,
  Entity,
  stringifyEntityRef,
} from '@backstage/catalog-model';
import {
  DependencyGraph,
  DependencyGraphTypes,
} from '@backstage/core-components';
import { errorApiRef, useApi } from '@backstage/core-plugin-api';
import CircularProgress from '@material-ui/core/CircularProgress';
import { makeStyles, useTheme } from '@material-ui/core/styles';
import classNames from 'classnames';
import { MouseEvent, ReactNode, useEffect, useMemo } from 'react';
import { DefaultRenderLabel } from './DefaultRenderLabel';
import { DefaultRenderNode } from './DefaultRenderNode';
import { ALL_RELATION_PAIRS, RelationPairs } from './relations';
import { Direction, EntityEdge, EntityNode } from './types';
import { useEntityRelationNodesAndEdges } from './useEntityRelationNodesAndEdges';
import { line, curveMonotoneX } from 'd3-shape';

/** @public */
export type EntityRelationsGraphClassKey = 'progress' | 'container' | 'graph';

const useStyles = makeStyles(
  theme => ({
    progress: {
      position: 'absolute',
      left: '50%',
      top: '50%',
      marginLeft: '-20px',
      marginTop: '-20px',
    },
    container: {
      position: 'relative',
      width: '100%',
      display: 'flex',
      flexDirection: 'column',
    },
    graph: {
      width: '100%',
      flex: 1,
      // Right now there is no good way to style edges between nodes, we have to
      // fall back to these hacks:
      '& path[marker-end]': {
        transition: 'filter 0.1s ease-in-out',
      },
      '& path[marker-end]:hover': {
        filter: `drop-shadow(2px 2px 4px ${theme.palette.primary.dark});`,
      },
      '& g[data-testid=label]': {
        transition: 'transform 0s',
      },
    },
  }),
  { name: 'PluginCatalogGraphEntityRelationsGraph' },
);

/**
 * @public
 */
export type EntityRelationsGraphProps = {
  rootEntityNames: CompoundEntityRef | CompoundEntityRef[];
  maxDepth?: number;
  unidirectional?: boolean;
  mergeRelations?: boolean;
  kinds?: string[];
  relations?: string[];
  entityFilter?: (entity: Entity) => boolean;
  direction?: Direction;
  onNodeClick?: (value: EntityNode, event: MouseEvent<unknown>) => void;
  relationPairs?: RelationPairs;
  className?: string;
  zoom?: 'enabled' | 'disabled' | 'enable-on-click';
  renderNode?: DependencyGraphTypes.RenderNodeFunction<EntityNode>;
  renderLabel?: DependencyGraphTypes.RenderLabelFunction<EntityEdge>;
  curve?: 'curveStepBefore' | 'curveMonotoneX';
  showArrowHeads?: boolean;
};

export const renderEdge = ({
  edge,
  id,
}: {
  edge: {
    points: { x: number; y: number }[];
    label?: string;
    labeloffset?: number;
    showArrowHeads?: boolean;
    relations: string[];
  };
  id: { v: string; w: string };
}): ReactNode => {
  if (!edge.points || edge.points.length < 2) return null;

  const pathGenerator = line<{ x: number; y: number }>()
    .x(d => d.x)
    .y(d => d.y)
    .curve(curveMonotoneX);

  const pathData = pathGenerator(edge.points);

  const midIndex = Math.floor(edge.points.length / 2);
  const midPoint = edge.points[midIndex];

  return (
    <g key={`${id.v}-${id.w}`}>
      <path
        d={pathData || ''}
        fill="none"
        stroke="red"
        strokeWidth={2}
        markerEnd={edge.showArrowHeads ? 'url(#arrowhead)' : undefined}
      />
      {edge.label && (
        <text
          x={midPoint.x}
          y={midPoint.y - (edge.labeloffset ?? 10)}
          textAnchor="middle"
          fontSize={12}
          fill="yellow"
        >
          {edge.relations.join(' / ')}
        </text>
      )}
    </g>
  );
};

/**
 * Core building block for custom entity relations diagrams.
 *
 * @public
 */
export const EntityRelationsGraph = (props: EntityRelationsGraphProps) => {
  const {
    rootEntityNames,
    maxDepth = 2,
    unidirectional = true,
    mergeRelations = true,
    kinds,
    relations,
    entityFilter,
    direction = Direction.LEFT_RIGHT,
    onNodeClick,
    relationPairs = ALL_RELATION_PAIRS,
    className,
    zoom = 'enabled',
    renderNode,
    renderLabel,
    curve,
    showArrowHeads,
  } = props;

  const theme = useTheme();
  const classes = useStyles();
  const rootEntityRefs = useMemo(
    () =>
      (Array.isArray(rootEntityNames)
        ? rootEntityNames
        : [rootEntityNames]
      ).map(e => stringifyEntityRef(e)),
    [rootEntityNames],
  );
  const errorApi = useApi(errorApiRef);
  const { loading, error, nodes, edges } = useEntityRelationNodesAndEdges({
    rootEntityRefs,
    maxDepth,
    unidirectional,
    mergeRelations,
    kinds,
    relations,
    entityFilter,
    onNodeClick,
    relationPairs,
  });

  useEffect(() => {
    if (error) {
      errorApi.post(error);
    }
  }, [errorApi, error]);

  return (
    <div className={classNames(classes.container, className)}>
      {loading && <CircularProgress className={classes.progress} />}
      {nodes && edges && (
        <DependencyGraph
          nodes={nodes}
          edges={edges}
          renderNode={renderNode || DefaultRenderNode}
          renderLabel={renderLabel || DefaultRenderLabel}
          renderEdge={renderEdge}
          direction={direction}
          className={classes.graph}
          paddingX={theme.spacing(4)}
          paddingY={theme.spacing(4)}
          labelPosition={DependencyGraphTypes.LabelPosition.RIGHT}
          labelOffset={theme.spacing(1)}
          zoom={zoom}
          curve={curve}
          showArrowHeads={showArrowHeads}
        />
      )}
    </div>
  );
};
