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
  getCompoundEntityRef,
  parseEntityRef,
  stringifyEntityRef,
} from '@backstage/catalog-model';
import { InfoCard, InfoCardVariants } from '@backstage/core-components';
import { useAnalytics, useRouteRef } from '@backstage/core-plugin-api';
import {
  humanizeEntityRef,
  useEntity,
  entityRouteRef,
} from '@backstage/plugin-catalog-react';
import { makeStyles, Theme } from '@material-ui/core/styles';
import qs from 'qs';
import { MouseEvent, ReactNode, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { catalogGraphRouteRef } from '../../routes';
import {
  ALL_RELATION_PAIRS,
  Direction,
  EntityNode,
  EntityRelationsGraph,
  EntityRelationsGraphProps,
} from '../EntityRelationsGraph';
import { useTranslationRef } from '@backstage/frontend-plugin-api';
import { catalogGraphTranslationRef } from '../../translation';
import { line, curveBasis } from 'd3-shape';

/** @public */
export type CatalogGraphCardClassKey = 'card' | 'graph';

const useStyles = makeStyles<Theme, { height: number | undefined }>(
  {
    card: ({ height }) => ({
      display: 'flex',
      flexDirection: 'column',
      maxHeight: height,
      minHeight: height,
    }),
    graph: {
      flex: 1,
      minHeight: 0,
    },
  },
  { name: 'PluginCatalogGraphCatalogGraphCard' },
);

export const renderEdge = ({
  edge,
  id,
}: {
  edge: {
    points: { x: number; y: number }[];
    label?: string;
    labeloffset?: number; // used as dy for nudging the label up/down the path visually
    showArrowHeads?: boolean;
    relations: string[];
  };
  id: { v: string; w: string };
}): ReactNode => {
  if (!edge.points || edge.points.length < 2) return null;

  // Styling decisions from relations
  const relationSet = new Set(edge.relations);
  const isOwner = relationSet.has('ownerOf');
  const isPart = relationSet.has('hasPart');
  const isApi = relationSet.has('apiProvidedBy');
  const isDepends = relationSet.has('dependsOn');

  const strokeDasharray = isPart ? '6,4' : isApi ? '2,2' : undefined;
  const strokeWidth = isDepends ? 3 : 2;
  const markerStart = isDepends ? 'url(#arrowheadstart)' : undefined;
  const markerEnd =
    edge.showArrowHeads || isOwner || isDepends ? 'url(#arrowhead)' : undefined;

  const pathGenerator = line<{ x: number; y: number }>()
    .x(d => markerStart ? d.x + 9 : d.x)
    .y(d => markerStart? d.y - 1: d.y)
    .curve(curveBasis);

  // Base path for the edge line
  const pathData = pathGenerator(edge.points) ?? '';

  // Direction helpers (used to decide whether to flip label path)
  const start = edge.points[0];
  const end = edge.points[edge.points.length - 1];
  const dx = end.x - start.x;
  const dy = end.y - start.y;

  // If the edge primarily goes right->left, reverse the label path so text reads LTR.
  // (This keeps the text orientation consistent, especially on curved paths.)
  const shouldFlipLabel = Math.abs(dx) >= Math.abs(dy) ? dx < 0 : dy < 0;
  const labelPathData = shouldFlipLabel
    ? pathGenerator([...edge.points].reverse()) ?? ''
    : pathData;

  // Unique ids for the visible path and the label path
  const pathId = `edge-path-${CSS.escape(`${id.v}-${id.w}`)}`;
  const labelPathId = `edge-label-path-${CSS.escape(`${id.v}-${id.w}`)}`;

  // What to render as the label text
  const labelText =
    edge.label && edge.label !== 'visible'
      ? edge.label
      : edge.relations.join(' / ');

  return (
    <g key={`${id.v}-${id.w}`}>
      {/* Visible edge line (with markers) */}
      <path
        id={pathId}
        d={pathData}
        fill="none"
        stroke={isApi ? "yellow" : "white"}
        strokeWidth={strokeWidth}
        strokeDasharray={strokeDasharray}
        markerStart={markerStart}
        markerEnd={markerEnd}
      />

      {/* Defs-only path for text (optionally reversed for consistent LTR labels) */}
      <defs>
        <path id={labelPathId} d={labelPathData} fill="none" />
      </defs>

      {edge.label === 'visible' || (edge.label && edge.label.length > 0) ? (
        <>
          <text
            fontSize={12}
            fill="white"
            stroke="rgba(0,0,0,0.6)"
            strokeWidth={4}
            paintOrder="stroke"
            pointerEvents="none"
            style={{ userSelect: 'none' }}
            textAnchor="middle"
          >
            <textPath href={`#${labelPathId}`} startOffset="50%">
              <tspan dy={edge.labeloffset - 15 ?? -15}>{labelText}</tspan>
            </textPath>
          </text>

          {/* Foreground text (sharp fill) */}
          <text
            fontSize={12}
            fill="white"
            pointerEvents="none"
            style={{ userSelect: 'none' }}
            textAnchor="middle"
          >
            <textPath href={`#${labelPathId}`} startOffset="50%">
              <tspan dy={edge.labeloffset - 15 ?? -15}>{labelText}</tspan>
            </textPath>
          </text>
        </>
      ) : null}
    </g>
  );
};

export const CatalogGraphCard = (
  props: Partial<EntityRelationsGraphProps> & {
    variant?: InfoCardVariants;
    height?: number;
    title?: string;
    action?: ReactNode;
  },
) => {
  const { t } = useTranslationRef(catalogGraphTranslationRef);
  const {
    variant = 'gridItem',
    relationPairs = ALL_RELATION_PAIRS,
    maxDepth = 1,
    unidirectional = true,
    mergeRelations = true,
    direction = Direction.LEFT_RIGHT,
    kinds,
    relations,
    entityFilter,
    height,
    className,
    action,
    rootEntityNames,
    onNodeClick,
    title = t('catalogGraphCard.title'),
    zoom = 'enable-on-click',
  } = props;

  const { entity } = useEntity();
  const entityName = useMemo(() => getCompoundEntityRef(entity), [entity]);
  const catalogEntityRoute = useRouteRef(entityRouteRef);
  const catalogGraphRoute = useRouteRef(catalogGraphRouteRef);
  const navigate = useNavigate();
  const classes = useStyles({ height });
  const analytics = useAnalytics();

  const defaultOnNodeClick = useCallback(
    (node: EntityNode, _: MouseEvent<unknown>) => {
      const nodeEntityName = parseEntityRef(node.id);
      const path = catalogEntityRoute({
        kind: nodeEntityName.kind.toLocaleLowerCase('en-US'),
        namespace: nodeEntityName.namespace.toLocaleLowerCase('en-US'),
        name: nodeEntityName.name,
      });
      analytics.captureEvent(
        'click',
        node.entity.metadata.title ?? humanizeEntityRef(nodeEntityName),
        { attributes: { to: path } },
      );
      navigate(path);
    },
    [catalogEntityRoute, navigate, analytics],
  );

  const catalogGraphParams = qs.stringify(
    {
      rootEntityRefs: [stringifyEntityRef(entity)],
      maxDepth: maxDepth,
      unidirectional,
      mergeRelations,
      selectedKinds: kinds,
      selectedRelations: relations,
      direction,
    },
    { arrayFormat: 'brackets', addQueryPrefix: true },
  );
  const catalogGraphUrl = `${catalogGraphRoute()}${catalogGraphParams}`;

  return (
    <InfoCard
      title={title}
      action={action}
      cardClassName={classes.card}
      variant={variant}
      noPadding
      deepLink={{
        title: t('catalogGraphCard.deepLinkTitle'),
        link: catalogGraphUrl,
      }}
    >
      <EntityRelationsGraph
        {...props}
        renderEdge={renderEdge}
        rootEntityNames={rootEntityNames || entityName}
        onNodeClick={onNodeClick || defaultOnNodeClick}
        className={className || classes.graph}
        maxDepth={maxDepth}
        unidirectional={unidirectional}
        mergeRelations={mergeRelations}
        direction={direction}
        relationPairs={relationPairs}
        entityFilter={entityFilter}
        zoom={zoom}
      />
    </InfoCard>
  );
};
