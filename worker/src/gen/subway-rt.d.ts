import * as $protobuf from "protobufjs/minimal.js";
import Long = require("long");

/** Namespace transit_realtime. */
export namespace transit_realtime {

    /**
     * Properties of a FeedMessage.
     * @deprecated Use transit_realtime.FeedMessage.$Properties instead.
     */
    interface IFeedMessage extends transit_realtime.FeedMessage.$Properties {
    }

    /** Represents a FeedMessage. */
    class FeedMessage {

        /**
         * Constructs a new FeedMessage.
         * @param [properties] Properties to set
         */
        constructor(properties?: transit_realtime.FeedMessage.$Properties);

        /** Unknown fields preserved while decoding when enabled */
        $unknowns?: Uint8Array[];

        /** FeedMessage header. */
        header?: (transit_realtime.FeedHeader.$Properties|null);

        /** FeedMessage entity. */
        entity: transit_realtime.FeedEntity.$Properties[];

        /**
         * Decodes a FeedMessage message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns {transit_realtime.FeedMessage & transit_realtime.FeedMessage.$Shape} FeedMessage
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): transit_realtime.FeedMessage & transit_realtime.FeedMessage.$Shape;
    }

    namespace FeedMessage {

        /** Properties of a FeedMessage. */
        interface $Properties {

            /** FeedMessage header */
            header?: (transit_realtime.FeedHeader.$Properties|null);

            /** FeedMessage entity */
            entity?: (transit_realtime.FeedEntity.$Properties[]|null);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];
        }

        /** Shape of a FeedMessage. */
        type $Shape = transit_realtime.FeedMessage.$Properties;
    }

    /**
     * Properties of a FeedHeader.
     * @deprecated Use transit_realtime.FeedHeader.$Properties instead.
     */
    interface IFeedHeader extends transit_realtime.FeedHeader.$Properties {
    }

    /** Represents a FeedHeader. */
    class FeedHeader {

        /**
         * Constructs a new FeedHeader.
         * @param [properties] Properties to set
         */
        constructor(properties?: transit_realtime.FeedHeader.$Properties);

        /** Unknown fields preserved while decoding when enabled */
        $unknowns?: Uint8Array[];

        /** FeedHeader gtfsRealtimeVersion. */
        gtfsRealtimeVersion?: (string|null);

        /** FeedHeader timestamp. */
        timestamp?: (number|Long|null);

        /**
         * Decodes a FeedHeader message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns {transit_realtime.FeedHeader & transit_realtime.FeedHeader.$Shape} FeedHeader
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): transit_realtime.FeedHeader & transit_realtime.FeedHeader.$Shape;
    }

    namespace FeedHeader {

        /** Properties of a FeedHeader. */
        interface $Properties {

            /** FeedHeader gtfsRealtimeVersion */
            gtfsRealtimeVersion?: (string|null);

            /** FeedHeader timestamp */
            timestamp?: (number|Long|null);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];
        }

        /** Shape of a FeedHeader. */
        type $Shape = transit_realtime.FeedHeader.$Properties;
    }

    /**
     * Properties of a FeedEntity.
     * @deprecated Use transit_realtime.FeedEntity.$Properties instead.
     */
    interface IFeedEntity extends transit_realtime.FeedEntity.$Properties {
    }

    /** Represents a FeedEntity. */
    class FeedEntity {

        /**
         * Constructs a new FeedEntity.
         * @param [properties] Properties to set
         */
        constructor(properties?: transit_realtime.FeedEntity.$Properties);

        /** Unknown fields preserved while decoding when enabled */
        $unknowns?: Uint8Array[];

        /** FeedEntity id. */
        id?: (string|null);

        /** FeedEntity isDeleted. */
        isDeleted?: (boolean|null);

        /** FeedEntity tripUpdate. */
        tripUpdate?: (transit_realtime.TripUpdate.$Properties|null);

        /** FeedEntity vehicle. */
        vehicle?: (transit_realtime.VehiclePosition.$Properties|null);

        /**
         * Decodes a FeedEntity message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns {transit_realtime.FeedEntity & transit_realtime.FeedEntity.$Shape} FeedEntity
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): transit_realtime.FeedEntity & transit_realtime.FeedEntity.$Shape;
    }

    namespace FeedEntity {

        /** Properties of a FeedEntity. */
        interface $Properties {

            /** FeedEntity id */
            id?: (string|null);

            /** FeedEntity isDeleted */
            isDeleted?: (boolean|null);

            /** FeedEntity tripUpdate */
            tripUpdate?: (transit_realtime.TripUpdate.$Properties|null);

            /** FeedEntity vehicle */
            vehicle?: (transit_realtime.VehiclePosition.$Properties|null);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];
        }

        /** Shape of a FeedEntity. */
        type $Shape = transit_realtime.FeedEntity.$Properties;
    }

    /**
     * Properties of a TripUpdate.
     * @deprecated Use transit_realtime.TripUpdate.$Properties instead.
     */
    interface ITripUpdate extends transit_realtime.TripUpdate.$Properties {
    }

    /** Represents a TripUpdate. */
    class TripUpdate {

        /**
         * Constructs a new TripUpdate.
         * @param [properties] Properties to set
         */
        constructor(properties?: transit_realtime.TripUpdate.$Properties);

        /** Unknown fields preserved while decoding when enabled */
        $unknowns?: Uint8Array[];

        /** TripUpdate trip. */
        trip?: (transit_realtime.TripDescriptor.$Properties|null);

        /** TripUpdate stopTimeUpdate. */
        stopTimeUpdate: transit_realtime.TripUpdate.StopTimeUpdate.$Properties[];

        /** TripUpdate timestamp. */
        timestamp?: (number|Long|null);

        /**
         * Decodes a TripUpdate message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns {transit_realtime.TripUpdate & transit_realtime.TripUpdate.$Shape} TripUpdate
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): transit_realtime.TripUpdate & transit_realtime.TripUpdate.$Shape;
    }

    namespace TripUpdate {

        /** Properties of a TripUpdate. */
        interface $Properties {

            /** TripUpdate trip */
            trip?: (transit_realtime.TripDescriptor.$Properties|null);

            /** TripUpdate stopTimeUpdate */
            stopTimeUpdate?: (transit_realtime.TripUpdate.StopTimeUpdate.$Properties[]|null);

            /** TripUpdate timestamp */
            timestamp?: (number|Long|null);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];
        }

        /** Shape of a TripUpdate. */
        type $Shape = transit_realtime.TripUpdate.$Properties;

        /**
         * Properties of a StopTimeEvent.
         * @deprecated Use transit_realtime.TripUpdate.StopTimeEvent.$Properties instead.
         */
        interface IStopTimeEvent extends transit_realtime.TripUpdate.StopTimeEvent.$Properties {
        }

        /** Represents a StopTimeEvent. */
        class StopTimeEvent {

            /**
             * Constructs a new StopTimeEvent.
             * @param [properties] Properties to set
             */
            constructor(properties?: transit_realtime.TripUpdate.StopTimeEvent.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** StopTimeEvent time. */
            time?: (number|Long|null);

            /**
             * Decodes a StopTimeEvent message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {transit_realtime.TripUpdate.StopTimeEvent & transit_realtime.TripUpdate.StopTimeEvent.$Shape} StopTimeEvent
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): transit_realtime.TripUpdate.StopTimeEvent & transit_realtime.TripUpdate.StopTimeEvent.$Shape;
        }

        namespace StopTimeEvent {

            /** Properties of a StopTimeEvent. */
            interface $Properties {

                /** StopTimeEvent time */
                time?: (number|Long|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a StopTimeEvent. */
            type $Shape = transit_realtime.TripUpdate.StopTimeEvent.$Properties;
        }

        /**
         * Properties of a StopTimeUpdate.
         * @deprecated Use transit_realtime.TripUpdate.StopTimeUpdate.$Properties instead.
         */
        interface IStopTimeUpdate extends transit_realtime.TripUpdate.StopTimeUpdate.$Properties {
        }

        /** Represents a StopTimeUpdate. */
        class StopTimeUpdate {

            /**
             * Constructs a new StopTimeUpdate.
             * @param [properties] Properties to set
             */
            constructor(properties?: transit_realtime.TripUpdate.StopTimeUpdate.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** StopTimeUpdate stopSequence. */
            stopSequence?: (number|null);

            /** StopTimeUpdate stopId. */
            stopId?: (string|null);

            /** StopTimeUpdate arrival. */
            arrival?: (transit_realtime.TripUpdate.StopTimeEvent.$Properties|null);

            /** StopTimeUpdate departure. */
            departure?: (transit_realtime.TripUpdate.StopTimeEvent.$Properties|null);

            /**
             * Decodes a StopTimeUpdate message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {transit_realtime.TripUpdate.StopTimeUpdate & transit_realtime.TripUpdate.StopTimeUpdate.$Shape} StopTimeUpdate
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): transit_realtime.TripUpdate.StopTimeUpdate & transit_realtime.TripUpdate.StopTimeUpdate.$Shape;
        }

        namespace StopTimeUpdate {

            /** Properties of a StopTimeUpdate. */
            interface $Properties {

                /** StopTimeUpdate stopSequence */
                stopSequence?: (number|null);

                /** StopTimeUpdate stopId */
                stopId?: (string|null);

                /** StopTimeUpdate arrival */
                arrival?: (transit_realtime.TripUpdate.StopTimeEvent.$Properties|null);

                /** StopTimeUpdate departure */
                departure?: (transit_realtime.TripUpdate.StopTimeEvent.$Properties|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a StopTimeUpdate. */
            type $Shape = transit_realtime.TripUpdate.StopTimeUpdate.$Properties;
        }
    }

    /**
     * Properties of a VehiclePosition.
     * @deprecated Use transit_realtime.VehiclePosition.$Properties instead.
     */
    interface IVehiclePosition extends transit_realtime.VehiclePosition.$Properties {
    }

    /** Represents a VehiclePosition. */
    class VehiclePosition {

        /**
         * Constructs a new VehiclePosition.
         * @param [properties] Properties to set
         */
        constructor(properties?: transit_realtime.VehiclePosition.$Properties);

        /** Unknown fields preserved while decoding when enabled */
        $unknowns?: Uint8Array[];

        /** VehiclePosition trip. */
        trip?: (transit_realtime.TripDescriptor.$Properties|null);

        /** VehiclePosition currentStopSequence. */
        currentStopSequence?: (number|null);

        /** VehiclePosition stopId. */
        stopId?: (string|null);

        /** VehiclePosition currentStatus. */
        currentStatus?: (transit_realtime.VehiclePosition.VehicleStopStatus|null);

        /** VehiclePosition timestamp. */
        timestamp?: (number|Long|null);

        /**
         * Decodes a VehiclePosition message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns {transit_realtime.VehiclePosition & transit_realtime.VehiclePosition.$Shape} VehiclePosition
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): transit_realtime.VehiclePosition & transit_realtime.VehiclePosition.$Shape;
    }

    namespace VehiclePosition {

        /** Properties of a VehiclePosition. */
        interface $Properties {

            /** VehiclePosition trip */
            trip?: (transit_realtime.TripDescriptor.$Properties|null);

            /** VehiclePosition currentStopSequence */
            currentStopSequence?: (number|null);

            /** VehiclePosition stopId */
            stopId?: (string|null);

            /** VehiclePosition currentStatus */
            currentStatus?: (transit_realtime.VehiclePosition.VehicleStopStatus|null);

            /** VehiclePosition timestamp */
            timestamp?: (number|Long|null);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];
        }

        /** Shape of a VehiclePosition. */
        type $Shape = transit_realtime.VehiclePosition.$Properties;

        /** VehicleStopStatus enum. */
        enum VehicleStopStatus {

            /** INCOMING_AT value */
            INCOMING_AT = 0,

            /** STOPPED_AT value */
            STOPPED_AT = 1,

            /** IN_TRANSIT_TO value */
            IN_TRANSIT_TO = 2
        }
    }

    /**
     * Properties of a TripDescriptor.
     * @deprecated Use transit_realtime.TripDescriptor.$Properties instead.
     */
    interface ITripDescriptor extends transit_realtime.TripDescriptor.$Properties {
    }

    /** Represents a TripDescriptor. */
    class TripDescriptor {

        /**
         * Constructs a new TripDescriptor.
         * @param [properties] Properties to set
         */
        constructor(properties?: transit_realtime.TripDescriptor.$Properties);

        /** Unknown fields preserved while decoding when enabled */
        $unknowns?: Uint8Array[];

        /** TripDescriptor tripId. */
        tripId?: (string|null);

        /** TripDescriptor startTime. */
        startTime?: (string|null);

        /** TripDescriptor startDate. */
        startDate?: (string|null);

        /** TripDescriptor routeId. */
        routeId?: (string|null);

        /** TripDescriptor nyctTripDescriptor. */
        nyctTripDescriptor?: (transit_realtime.NyctTripDescriptor.$Properties|null);

        /**
         * Decodes a TripDescriptor message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns {transit_realtime.TripDescriptor & transit_realtime.TripDescriptor.$Shape} TripDescriptor
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): transit_realtime.TripDescriptor & transit_realtime.TripDescriptor.$Shape;
    }

    namespace TripDescriptor {

        /** Properties of a TripDescriptor. */
        interface $Properties {

            /** TripDescriptor tripId */
            tripId?: (string|null);

            /** TripDescriptor startTime */
            startTime?: (string|null);

            /** TripDescriptor startDate */
            startDate?: (string|null);

            /** TripDescriptor routeId */
            routeId?: (string|null);

            /** TripDescriptor nyctTripDescriptor */
            nyctTripDescriptor?: (transit_realtime.NyctTripDescriptor.$Properties|null);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];
        }

        /** Shape of a TripDescriptor. */
        type $Shape = transit_realtime.TripDescriptor.$Properties;
    }

    /**
     * Properties of a NyctTripDescriptor.
     * @deprecated Use transit_realtime.NyctTripDescriptor.$Properties instead.
     */
    interface INyctTripDescriptor extends transit_realtime.NyctTripDescriptor.$Properties {
    }

    /** Represents a NyctTripDescriptor. */
    class NyctTripDescriptor {

        /**
         * Constructs a new NyctTripDescriptor.
         * @param [properties] Properties to set
         */
        constructor(properties?: transit_realtime.NyctTripDescriptor.$Properties);

        /** Unknown fields preserved while decoding when enabled */
        $unknowns?: Uint8Array[];

        /** NyctTripDescriptor trainId. */
        trainId?: (string|null);

        /** NyctTripDescriptor isAssigned. */
        isAssigned?: (boolean|null);

        /** NyctTripDescriptor direction. */
        direction?: (transit_realtime.NyctTripDescriptor.Direction|null);

        /**
         * Decodes a NyctTripDescriptor message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns {transit_realtime.NyctTripDescriptor & transit_realtime.NyctTripDescriptor.$Shape} NyctTripDescriptor
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): transit_realtime.NyctTripDescriptor & transit_realtime.NyctTripDescriptor.$Shape;
    }

    namespace NyctTripDescriptor {

        /** Properties of a NyctTripDescriptor. */
        interface $Properties {

            /** NyctTripDescriptor trainId */
            trainId?: (string|null);

            /** NyctTripDescriptor isAssigned */
            isAssigned?: (boolean|null);

            /** NyctTripDescriptor direction */
            direction?: (transit_realtime.NyctTripDescriptor.Direction|null);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];
        }

        /** Shape of a NyctTripDescriptor. */
        type $Shape = transit_realtime.NyctTripDescriptor.$Properties;

        /** Direction enum. */
        enum Direction {

            /** NORTH value */
            NORTH = 1,

            /** EAST value */
            EAST = 2,

            /** SOUTH value */
            SOUTH = 3,

            /** WEST value */
            WEST = 4
        }
    }
}
