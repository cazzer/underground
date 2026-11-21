/** Hand-written toy feed (no real data): three stations.
 *  AAA: entrances reach a mezzanine, one escalator (EQ1) reaches both AAAN and AAAS (an island platform).
 *  BBB: no mezzanine; separate entrance stairs to each platform (per direction).
 *  CCC: two mezzanines, one per direction, each with its own stairs. */
import { describe, expect, it } from 'vitest'
import { parseCsv } from './csv.ts'
import { pathwaysTopology } from './pathwaysTopology.ts'

const STOPS = `stop_id,stop_name,stop_lat,stop_lon,location_type,parent_station
AAA,Alpha,0,0,1,
AAAN,Alpha,0,0,,AAA
AAAS,Alpha,0,0,,AAA
M-A-ENT1,Alpha entrance,0,0,2,M-A
M-A-MEZZ1,Alpha mezzanine,0,0,3,M-A
BBBN,Beta,0,0,,BBB
BBBS,Beta,0,0,,BBB
M-B-ENT1,Beta north entrance,0,0,2,M-B
M-B-ENT2,Beta south entrance,0,0,2,M-B
CCCN,Gamma,0,0,,CCC
CCCS,Gamma,0,0,,CCC
M-C-MEZZ1,Gamma north mezzanine,0,0,3,M-C
M-C-MEZZ2,Gamma south mezzanine,0,0,3,M-C
`
const HEADER = 'pathway_id,from_stop_id,to_stop_id,pathway_mode,is_bidirectional,mta_equipment_id\n'
const PATHWAYS = `${HEADER}p1,M-A-ENT1,M-A-MEZZ1,2,1,
p2,M-A-MEZZ1,M-A-MEZZ1,6,0,
p3,M-A-MEZZ1,AAAN,4,1,EQ1
p4,M-A-MEZZ1,AAAS,4,1,EQ1
p5,M-B-ENT1,BBBN,2,1,
p6,BBBS,M-B-ENT2,2,1,
p7,M-C-MEZZ1,CCCN,2,1,
p8,CCCS,M-C-MEZZ2,5,1,EQ9
p9,M-C-MEZZ1,M-C-MEZZ2,1,1,
`

const topo = pathwaysTopology(parseCsv(STOPS, 'stops.txt', ['stop_id', 'location_type']), parseCsv(PATHWAYS, 'pathways.txt', ['from_stop_id', 'to_stop_id', 'pathway_mode']))

describe('pathwaysTopology', () => {
  it('reads an island station: mezzanine, shared escalator, both directions through one mezzanine', () => {
    expect(topo.get('AAA')).toEqual({ gtfsStationId: 'AAA', platformNodes: ['AAAN', 'AAAS'], hasMezzanine: true, mezzanineCount: 1, perDirection: false, sharedConnector: true })
  })

  it('reads stairs straight from per-direction entrances as no mezzanine, per direction', () => {
    expect(topo.get('BBB')).toMatchObject({ hasMezzanine: false, mezzanineCount: 0, perDirection: true, sharedConnector: false })
  })

  it('counts one mezzanine per direction, joined only by a walkway, as per direction', () => {
    expect(topo.get('CCC')).toMatchObject({ hasMezzanine: true, mezzanineCount: 2, perDirection: true, sharedConnector: false })
  })

  it('ignores fare gates and walkways, and anything that is not a platform node', () => {
    expect(topo.size).toBe(3)
    expect(topo.has('M-A')).toBe(false)
  })

  it('has no perDirection answer with a platform on one side only', () => {
    const t = pathwaysTopology(parseCsv(STOPS, 's', ['stop_id']), parseCsv(`${HEADER}x,M-A-MEZZ1,AAAN,2,1,\n`, 'p', ['from_stop_id']))
    expect(t.get('AAA')).toMatchObject({ perDirection: null, sharedConnector: false })
  })
})
